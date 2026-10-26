// Tests de la fenetre « Taches du mois » (top/monthTasksModal.js) : modele pur
// (buildBucketTaskList) puis controleur DOM simule a la main, dans le style de
// chargeAssignModalDom.test.mjs.

import { test } from "node:test";
import assert from "node:assert/strict";

import { buildBucketTaskList, createMonthTasksModal, de } from "../assets/js/top/monthTasksModal.js";
import { OVERFLOW_REASON_LABELS } from "../assets/js/top/taskLabels.js";

// --- DOM minimal ---------------------------------------------------------------

class FakeElement {
  constructor(id = "") {
    this.id = id;
    this.textContent = "";
    this.innerHTML = "";
    this.hidden = false;
    this.style = {};
    this.children = [];
    this.listeners = new Map();
  }
  querySelector(selector) {
    const id = selector.replace("#", "");
    return this.children.find((child) => child.id === id) || null;
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
    (this.listeners.get(type) || []).slice().forEach((fn) => fn({ target: this, ...event }));
  }
}

// La fenetre ne s'installe que sur un vrai element (garde `instanceof
// HTMLElement`, comme bottom/chargeAssignModal.js).
globalThis.HTMLElement = FakeElement;

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
  fire(type, event) {
    (documentListeners.get(type) || []).slice().forEach((fn) => fn(event));
  },
};

function buildRoot() {
  const root = new FakeElement("ps-month-tasks-modal");
  root.style.display = "none";
  root.children = [
    new FakeElement("ps-month-tasks-title"),
    new FakeElement("ps-month-tasks-banner"),
    new FakeElement("ps-month-tasks-body"),
    new FakeElement("ps-month-tasks-close"),
  ];
  return root;
}

// --- jeux de donnees -------------------------------------------------------------

function task(over) {
  return {
    rowId: 1, id2: "100", name: "Tache", zone: "", groupe: "", groupKey: "", type: "COFFRAGE",
    dueIso: "2027-04-10", realized: false, smoothedIso: "2027-04-10", monthsAdvanced: 0,
    moved: false, frozen: false, pulledFor: null, rule4Exception: false, ...over,
  };
}
const APRIL = { startIso: "2027-04-01", endIso: "2027-05-01", label: "avril 2027" };
const noResult = (tasks, extra = {}) => ({ active: false, tasks, movedCount: 0, overflows: [], ...extra });
const build = (over) =>
  buildBucketTaskList({ result: noResult([]), mode: "raw", bucket: APRIL, visibleTypeKeys: [], settings: {}, ...over });

// --- modele pur --------------------------------------------------------------------

test("mode raw : filtre sur l'echeance d'origine, seau [start, end)", () => {
  const tasks = [
    task({ rowId: 1, dueIso: "2027-04-01", smoothedIso: "2027-05-03" }),
    task({ rowId: 2, dueIso: "2027-04-30" }),
    task({ rowId: 3, dueIso: "2027-05-01" }),
    task({ rowId: 4, dueIso: "2027-03-31" }),
  ];
  const model = build({ result: noResult(tasks) });
  assert.deepEqual(model.sections[0].items.map((i) => i.rowId), [1, 2]);
  assert.equal(model.empty, false);
  assert.equal(model.flat, true);
  assert.equal(model.modeLabel, "non lissé");
  assert.equal(model.title, "Tâches à réaliser — avril 2027 · non lissé");
});

test("mode smoothed : filtre sur l'echeance lissee, pas de departed", () => {
  const tasks = [
    task({ rowId: 1, dueIso: "2027-05-12", smoothedIso: "2027-04-12", moved: true, monthsAdvanced: 1 }),
    task({ rowId: 2, dueIso: "2027-04-20", smoothedIso: "2027-03-20", moved: true, monthsAdvanced: 1 }),
  ];
  const model = build({ result: noResult(tasks), mode: "smoothed" });
  assert.deepEqual(model.sections[0].items.map((i) => i.rowId), [1]);
  assert.deepEqual(model.departed, []);
  assert.equal(model.modeLabel, "lissé");
});

test("mode both : comme smoothed + departed avec le mois d'arrivee", () => {
  const tasks = [
    task({ rowId: 1, dueIso: "2027-05-12", smoothedIso: "2027-04-12", moved: true }),
    task({ rowId: 2, id2: "120", name: "Voile R+1", dueIso: "2027-04-20", smoothedIso: "2027-03-20", moved: true }),
  ];
  const model = build({ result: noResult(tasks), mode: "both" });
  assert.deepEqual(model.sections[0].items.map((i) => i.rowId), [1]);
  assert.deepEqual(model.departed, [{ id2: "120", name: "Voile R+1", toMonthLabel: "mars 2027" }]);
  assert.equal(model.modeLabel, "les deux");
});

test("filtre de types : un type, tous (vide), plusieurs dans TYPE_ORDER", () => {
  const tasks = [
    task({ rowId: 1, type: "ARMATURES" }),
    task({ rowId: 2, type: "COFFRAGE" }),
    task({ rowId: 3, type: "NDC" }),
  ];
  const one = build({ result: noResult(tasks), visibleTypeKeys: ["ARMATURES"] });
  assert.equal(one.sections.length, 1);
  assert.equal(one.flat, true);
  const all = build({ result: noResult(tasks), visibleTypeKeys: [] });
  assert.deepEqual(all.sections.map((s) => s.type), ["COFFRAGE", "ARMATURES", "NDC"]);
  assert.equal(all.flat, false);
  const some = build({ result: noResult(tasks), visibleTypeKeys: ["NDC", "COFFRAGE"] });
  assert.deepEqual(some.sections.map((s) => s.type), ["COFFRAGE", "NDC"]);
  assert.equal(some.sections[0].label, "Coffrage");
  assert.equal(some.sections[0].color, "#d97706");
  assert.equal(some.flat, false);
});

test("tri par date puis id2, lieu, mention d'avance et de coffrage entraine", () => {
  const tasks = [
    task({ rowId: 1, id2: "9", dueIso: "2027-04-12", smoothedIso: "2027-04-12" }),
    task({ rowId: 2, id2: "145", name: "Poteaux", zone: "Zone A", groupe: "3", dueIso: "2027-05-12", smoothedIso: "2027-04-12", moved: true, monthsAdvanced: 1, pulledFor: "150" }),
    task({ rowId: 3, id2: "1", dueIso: "2027-04-02", smoothedIso: "2027-04-02" }),
    task({ rowId: 4, id2: "150", name: "Arm", type: "ARMATURES", dueIso: "2027-04-30", smoothedIso: "2027-04-30" }),
  ];
  const model = build({ result: noResult(tasks), mode: "smoothed", visibleTypeKeys: ["COFFRAGE"] });
  const items = model.sections[0].items;
  // Meme date (12/04) : tri par N° texte-numerique, 9 avant 145.
  assert.deepEqual(items.map((i) => i.rowId), [3, 1, 2]);
  const moved = items[2];
  assert.equal(moved.dateLabel, "12/04/2027");
  assert.equal(moved.place, "Zone A · Groupe 3");
  assert.equal(moved.movedFrom, "mai 2027 (12/05/2027)");
  assert.equal(moved.pulledFor, "N° 150");
  assert.equal(items[0].place, "");
  assert.equal(items[0].movedFrom, null);
});

test("pulledFor vide : repli sur le nom de l'armature du groupe", () => {
  const tasks = [
    task({ rowId: 1, groupKey: "G1", dueIso: "2027-05-05", smoothedIso: "2027-04-05", moved: true, pulledFor: "" }),
    task({ rowId: 2, id2: "", name: "Armature mur", type: "ARMATURES", groupKey: "G1", dueIso: "2027-04-05", smoothedIso: "2027-04-05" }),
  ];
  const model = build({ result: noResult(tasks), mode: "smoothed", visibleTypeKeys: ["COFFRAGE"] });
  assert.equal(model.sections[0].items[0].pulledFor, "Armature mur");
  const orphan = [task({ rowId: 1, dueIso: "2027-05-05", smoothedIso: "2027-04-05", moved: true, pulledFor: "" })];
  const m2 = build({ result: noResult(orphan), mode: "smoothed" });
  assert.equal(m2.sections[0].items[0].pulledFor, "N° ?");
});

test("mode raw : aucune mention d'avance ni de coffrage entraine", () => {
  const tasks = [task({ dueIso: "2027-04-12", smoothedIso: "2027-03-12", moved: true, pulledFor: "7" })];
  const item = build({ result: noResult(tasks) }).sections[0].items[0];
  assert.equal(item.movedFrom, null);
  assert.equal(item.pulledFor, null);
  assert.equal(item.dateLabel, "12/04/2027");
});

test("countLabel et avertissement de depassement (seau mensuel)", () => {
  const tasks = [
    task({ rowId: 1, type: "ARMATURES" }),
    task({ rowId: 2, type: "ARMATURES" }),
    task({ rowId: 3, type: "ARMATURES" }),
    task({ rowId: 4, type: "COFFRAGE" }),
  ];
  const settings = { maxTotal: null, maxByType: { ARMATURES: 2 } };
  const result = {
    active: true, tasks, movedCount: 0,
    overflows: [{ month: "2027-04", series: "ARMATURES", count: 3, max: 2, reason: "coffrage-sans-place" }],
  };
  const model = build({ result, mode: "smoothed", settings });
  const arm = model.sections.find((s) => s.type === "ARMATURES");
  const cof = model.sections.find((s) => s.type === "COFFRAGE");
  assert.equal(arm.countLabel, "3 / 2");
  assert.equal(arm.warning, "Dépassement : 3 / 2 — coffrage sans place");
  assert.equal(cof.countLabel, "1");
  assert.equal(cof.warning, null);
  assert.equal(model.banner, null);
  assert.equal(OVERFLOW_REASON_LABELS["coffrage-sans-place"], "coffrage sans place");
});

test("depassement TOTAL -> banniere ; seau hebdomadaire -> pas d'avertissement", () => {
  const tasks = [task({ rowId: 1 }), task({ rowId: 2 })];
  const result = {
    active: true, tasks, movedCount: 0,
    overflows: [
      { month: "2027-04", series: "TOTAL", count: 2, max: 1, reason: "mois-en-cours" },
      { month: "2027-04", series: "COFFRAGE", count: 2, max: 1, reason: "mois-en-cours" },
    ],
  };
  const settings = { maxTotal: 1, maxByType: { COFFRAGE: 1 } };
  const monthly = build({ result, mode: "smoothed", settings });
  assert.equal(monthly.banner, "Dépassement du total : 2 / 1 — mois en cours");
  assert.equal(monthly.sections[0].warning, "Dépassement : 2 / 1 — mois en cours");
  const week = { startIso: "2027-04-05", endIso: "2027-04-12", label: "semaine du 05/04/2027" };
  const weekly = build({ result, mode: "smoothed", settings, bucket: week });
  assert.equal(weekly.banner, null);
  assert.equal(weekly.sections[0].warning, null);
  assert.equal(weekly.sections[0].countLabel, "2");
});

test("seau vide : empty vrai", () => {
  const model = build({ result: noResult([task({ dueIso: "2028-01-01", smoothedIso: "2028-01-01" })]) });
  assert.equal(model.empty, true);
  assert.deepEqual(model.sections, []);
});

// --- DOM -----------------------------------------------------------------------------

test("open affiche, update remplace sans fermer, Echap et Fermer ferment", () => {
  const root = buildRoot();
  const modal = createMonthTasksModal(root);
  const model = build({ result: noResult([task({ name: "Voile <b>x</b> & \"y\"", id2: "<i>" })]) });
  assert.equal(modal.isOpen(), false);
  modal.open(model);
  assert.equal(root.style.display, "flex");
  assert.equal(modal.isOpen(), true);
  const body = root.querySelector("#ps-month-tasks-body");
  assert.ok(body.innerHTML.includes("Voile &lt;b&gt;x&lt;/b&gt; &amp; &quot;y&quot;"));
  assert.ok(!body.innerHTML.includes("<b>x</b>"));
  assert.ok(body.innerHTML.includes("&lt;i&gt;"));
  assert.equal(root.querySelector("#ps-month-tasks-title").textContent, model.title);

  modal.update(build({ result: noResult([task({ name: "Autre" })]) }));
  assert.equal(modal.isOpen(), true);
  assert.ok(body.innerHTML.includes("Autre"));
  assert.ok(!body.innerHTML.includes("Voile"));

  document.fire("keydown", { key: "Enter" });
  assert.equal(modal.isOpen(), true);
  document.fire("keydown", { key: "Escape" });
  assert.equal(modal.isOpen(), false);
  assert.equal(root.style.display, "none");

  modal.open(model);
  root.querySelector("#ps-month-tasks-close").dispatch("click");
  assert.equal(modal.isOpen(), false);

  modal.open(model);
  root.dispatch("click"); // clic sur le fond (target = root)
  assert.equal(modal.isOpen(), false);

  modal.destroy();
  assert.equal(documentListeners.get("keydown").length, 0);
});

test("update sur fenetre fermee : ne l'ouvre pas ; seau vide : texte rendu", () => {
  const root = buildRoot();
  const modal = createMonthTasksModal(root);
  modal.update(build());
  assert.equal(modal.isOpen(), false);
  modal.open(build());
  const body = root.querySelector("#ps-month-tasks-body");
  assert.ok(body.innerHTML.includes("Aucune tâche à réaliser sur cette période."));
  modal.destroy();
});

test("rendu : sections, avertissement, banniere et parties plus tot", () => {
  const root = buildRoot();
  const modal = createMonthTasksModal(root);
  const tasks = [
    task({ rowId: 1, id2: "131", type: "COFFRAGE", realized: true }),
    task({ rowId: 2, id2: "120", name: "Parti", dueIso: "2027-04-20", smoothedIso: "2027-03-20", moved: true }),
  ];
  const result = {
    active: true, tasks, movedCount: 1,
    overflows: [{ month: "2027-04", series: "TOTAL", count: 1, max: 0, reason: "plus-de-place" }],
  };
  const model = build({ result, mode: "both", settings: { maxTotal: 1, maxByType: {} }, visibleTypeKeys: ["COFFRAGE", "ARMATURES"] });
  modal.open(model);
  const html = root.querySelector("#ps-month-tasks-body").innerHTML;
  assert.ok(html.includes("réalisée"));
  assert.ok(html.includes("Parties plus tôt (1)"));
  assert.ok(html.includes("mars 2027"));
  const banner = root.querySelector("#ps-month-tasks-banner");
  assert.equal(banner.hidden, false);
  assert.ok(banner.textContent.includes("plus de place avant"));
  modal.destroy();
});

// --- balisage absent ------------------------------------------------------------

// index.html reste en cache sans le bloc #ps-month-tasks-modal : la fenetre doit
// etre inerte, jamais lever d'exception — le controleur du lissage la cree au
// demarrage, et une exception laisserait tout le widget blanc.
test("balisage absent : fenetre inerte, aucune exception, aucun ecouteur", () => {
  const before = (documentListeners.get("keydown") || []).length;
  for (const rootEl of [null, undefined, {}]) {
    let modal = null;
    assert.doesNotThrow(() => {
      modal = createMonthTasksModal(rootEl);
    });
    assert.doesNotThrow(() => {
      modal.open(build());
      modal.update(build());
      modal.close();
    });
    assert.equal(modal.isOpen(), false);
    assert.doesNotThrow(() => modal.destroy());
  }
  assert.equal((documentListeners.get("keydown") || []).length, before);
});

// --- elision -----------------------------------------------------------------------

test("de(label) : elision devant une voyelle, accents compris", () => {
  assert.equal(de("avril 2027"), "d'avril 2027");
  assert.equal(de("août 2027"), "d'août 2027");
  assert.equal(de("octobre 2027"), "d'octobre 2027");
  assert.equal(de("Avril 2027"), "d'Avril 2027");
  assert.equal(de("été 2027"), "d'été 2027");
  assert.equal(de("Île"), "d'Île");
  assert.equal(de("mars 2027"), "de mars 2027");
  assert.equal(de("décembre 2027"), "de décembre 2027");
  assert.equal(de("juin 2027"), "de juin 2027");
});

test("rendu : « avancée d'avril », « avancée d'août », « avancée de mai »", () => {
  const root = buildRoot();
  const modal = createMonthTasksModal(root);
  const tasks = [
    task({ rowId: 1, id2: "1", dueIso: "2027-04-20", smoothedIso: "2027-03-20", moved: true, monthsAdvanced: 1 }),
    task({ rowId: 2, id2: "2", dueIso: "2027-05-20", smoothedIso: "2027-03-22", moved: true, monthsAdvanced: 2 }),
    task({ rowId: 3, id2: "3", dueIso: "2027-08-10", smoothedIso: "2027-03-24", moved: true, monthsAdvanced: 5 }),
  ];
  const MARCH = { startIso: "2027-03-01", endIso: "2027-04-01", label: "mars 2027" };
  modal.open(build({ result: noResult(tasks), mode: "smoothed", bucket: MARCH }));
  const html = root.querySelector("#ps-month-tasks-body").innerHTML;
  assert.ok(html.includes("avancée d'avril 2027 (20/04/2027)"), html);
  assert.ok(html.includes("avancée d'août 2027 (10/08/2027)"), html);
  assert.ok(html.includes("avancée de mai 2027 (20/05/2027)"), html);
  assert.ok(!html.includes("avancée de avril"));
  modal.destroy();
});

test("countLabel : le maximum propre au mois du seau remplace celui de tous les mois", () => {
  const tasks = [
    task({ rowId: 1, type: "ARMATURES" }),
    task({ rowId: 2, type: "ARMATURES" }),
    task({ rowId: 3, type: "COFFRAGE" }),
  ];
  const settings = {
    maxTotal: null,
    maxByType: { ARMATURES: 4 },
    maxByMonth: {
      "2027-04": { maxTotal: null, maxByType: { ARMATURES: 2, COFFRAGE: 1 } },
      "2027-05": { maxTotal: null, maxByType: { ARMATURES: 9 } },
    },
  };
  const result = { active: true, tasks, movedCount: 0, overflows: [] };
  const model = build({ result, mode: "smoothed", settings });
  assert.equal(model.sections.find((s) => s.type === "ARMATURES").countLabel, "2 / 2");
  assert.equal(model.sections.find((s) => s.type === "COFFRAGE").countLabel, "1 / 1");
});
