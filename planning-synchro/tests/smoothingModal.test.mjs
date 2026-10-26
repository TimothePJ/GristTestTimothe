// Tests de la fenetre « Lissage des taches » (top/smoothingModal.js) : fonctions
// pures (computeTypePeaks, buildPreviewRows) puis controleur DOM simule a la main,
// dans le style de monthTasksModal.test.mjs.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildMonthChoices,
  buildPreviewRows,
  buildStartOptions,
  computeTypePeaks,
  createSmoothingModal,
} from "../assets/js/top/smoothingModal.js";
import { smoothTasks } from "../assets/js/top/taskSmoothing.js";

// --- DOM minimal ---------------------------------------------------------------

class FakeElement {
  constructor(id = "") {
    this.id = id;
    this.textContent = "";
    this.innerHTML = "";
    this.value = "";
    this.hidden = false;
    this.disabled = false;
    this.style = {};
    this.dataset = {};
    this.attributes = new Map();
    this.children = [];
    this.listeners = new Map();
  }
  querySelector(selector) {
    const id = selector.replace("#", "");
    return this.children.find((child) => child.id === id) || null;
  }
  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }
  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }
  removeAttribute(name) {
    this.attributes.delete(name);
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

let confirmAnswer = true;
let confirmCalls = 0;
globalThis.window = {
  confirm() {
    confirmCalls += 1;
    return confirmAnswer;
  },
};

const IDS = [
  "title", "close", "readonly", "total", "types", "field-error", "preview", "feedback", "delete", "cancel", "save",
];

// Elements ajoutes avec le mois de depart et les mois particuliers : absents
// d'un index.html reste en cache, d'ou les tests sans eux (setup sans `full`).
const NEW_IDS = ["start", "months", "month-select", "month-add"];

function buildRoot(extra = []) {
  const root = new FakeElement("ps-smoothing-modal");
  root.style.display = "none";
  root.children = [...IDS, ...extra].map((name) => new FakeElement(`ps-smoothing-${name}`));
  const get = (name) => root.querySelector(`#ps-smoothing-${name}`);
  return { root, get };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Saisie dans une ligne par type : l'evenement est delegue sur le conteneur.
function typeInTypeRow(get, type, value) {
  get("types").dispatch("input", { target: { dataset: { type }, value, setAttribute() {}, removeAttribute() {} } });
}
function typeInTotal(get, value) {
  const total = get("total");
  total.value = value;
  total.dispatch("input");
}

// --- jeux de donnees -------------------------------------------------------------

const TODAY = "2027-01-10";
let nextId = 1;
function task(type, dueIso, over = {}) {
  nextId += 1;
  return {
    rowId: nextId, id2: String(nextId), name: `Tache ${nextId}`, zone: "", groupe: "", groupKey: "", type,
    dueIso, realized: false, ...over,
  };
}
const many = (count, type, dueIso) => Array.from({ length: count }, () => task(type, dueIso));

// Exemple A : 2 taches en mars, 8 en avril, maximum general 4.
const exampleA = () => [...many(2, "NDC", "2027-03-10"), ...many(8, "NDC", "2027-04-10")];

// --- computeTypePeaks -------------------------------------------------------------

test("computeTypePeaks : pic et mois par type, mois passes ignores", () => {
  const tasks = [
    ...many(9, "COFFRAGE", "2026-11-05"), // mois passe : ignore
    ...many(2, "COFFRAGE", "2027-03-05"),
    ...many(5, "COFFRAGE", "2027-04-05"),
    ...many(1, "NDC", "2027-03-20"),
    ...many(3, "ARMATURES", "2027-01-30"), // mois courant : compte
  ];
  const peaks = computeTypePeaks(tasks, TODAY);
  assert.deepEqual(peaks.COFFRAGE, { count: 5, monthKey: "2027-04" });
  assert.deepEqual(peaks.NDC, { count: 1, monthKey: "2027-03" });
  assert.deepEqual(peaks.ARMATURES, { count: 3, monthKey: "2027-01" });
  assert.equal(peaks.COUPES, undefined);
});

test("computeTypePeaks : a egalite, le mois le plus tot", () => {
  const tasks = [...many(2, "NDC", "2027-05-05"), ...many(2, "NDC", "2027-03-05")];
  assert.deepEqual(computeTypePeaks(tasks, TODAY).NDC, { count: 2, monthKey: "2027-03" });
});

// --- buildPreviewRows -------------------------------------------------------------

test("buildPreviewRows : exemple A -> fevrier 0->2, mars 2->4, avril 8->4", () => {
  const result = smoothTasks(exampleA(), { maxTotal: 4, maxByType: {} }, TODAY);
  const rows = buildPreviewRows(result, TODAY);
  assert.deepEqual(
    rows.map((row) => [row.label, row.before, row.after]),
    [["février 2027", 0, 2], ["mars 2027", 2, 4], ["avril 2027", 8, 4]]
  );
  assert.ok(rows.every((row) => row.overflow === false));
});

test("buildPreviewRows : un mois inchange est omis, un mois en depassement reste", () => {
  const tasks = [...many(1, "NDC", "2027-02-10"), ...many(3, "NDC", "2027-05-10")];
  const result = smoothTasks(tasks, { maxTotal: 3, maxByType: {} }, TODAY);
  assert.deepEqual(buildPreviewRows(result, TODAY), []);

  // Mois courant a 3 taches pour un maximum de 2 : rien ne peut avancer, il reste signale.
  const tight = smoothTasks(many(3, "NDC", "2027-01-20"), { maxTotal: 2, maxByType: {} }, TODAY);
  const rows = buildPreviewRows(tight, TODAY);
  assert.deepEqual(rows.map((row) => [row.monthKey, row.before, row.after, row.overflow]), [["2027-01", 3, 3, true]]);
});

// --- controleur DOM ---------------------------------------------------------------

function setup(over = {}) {
  const { root, get } = buildRoot(over.full ? NEW_IDS : []);
  const calls = { compute: [], submit: [], del: 0 };
  const tasks = over.tasks || [...exampleA(), ...many(5, "COFFRAGE", "2027-04-12"), ...many(1, "NDC", "2027-03-20")];
  const modal = createSmoothingModal(root, {
    compute: (settings) => {
      calls.compute.push(settings);
      return smoothTasks(tasks, settings, TODAY);
    },
    onSubmit: async (settings) => {
      calls.submit.push(settings);
      return over.submitResult || { ok: true };
    },
    onDelete: async () => {
      calls.del += 1;
      return over.deleteResult || { ok: true };
    },
    debounceMs: 0,
  });
  const context = {
    title: "Lissage des tâches — Projet X · Gros œuvre",
    typesPresent: ["NDC", "COFFRAGE"], // volontairement dans le desordre
    tasks,
    todayIso: TODAY,
    settings: { maxTotal: null, maxByType: {} },
    saved: false,
    readOnly: false,
    ...(over.context || {}),
  };
  return { root, get, modal, calls, context, tasks };
}

test("open : champ general rempli, une ligne par type present dans l'ordre TYPE_ORDER, pic actuel", () => {
  const { root, get, modal, context } = setup({
    context: { settings: { maxTotal: 4, maxByType: { COFFRAGE: 2 } } },
  });
  modal.open(context);
  assert.equal(root.style.display, "flex");
  assert.equal(modal.isOpen(), true);
  assert.equal(get("title").textContent, context.title);
  assert.equal(get("total").value, "4");
  const html = get("types").innerHTML;
  assert.ok(html.indexOf("Coffrage") >= 0 && html.indexOf("NDC") > html.indexOf("Coffrage"));
  assert.ok(html.includes("pic actuel 5 (avril 2027)"), html);
  assert.ok(html.includes("pic actuel 8 (avril 2027)"), html);
  assert.ok(html.includes('value="2"'));
  assert.ok(!html.includes("Armature"), "un type absent n'a pas de ligne");
});

test("saisie : relance compute apres le delai et affiche l'apercu", async () => {
  const { get, modal, calls, context } = setup({ tasks: exampleA() });
  modal.open(context);
  const before = calls.compute.length;
  typeInTotal(get, "4");
  assert.equal(calls.compute.length, before, "pas de calcul avant le delai");
  await sleep(10);
  assert.equal(calls.compute.length, before + 1);
  assert.deepEqual(calls.compute.at(-1), { maxTotal: 4, maxByType: {} });
  const preview = get("preview").innerHTML;
  assert.ok(preview.includes("6 tâches avancées · aucune tâche retardée"), preview);
  assert.ok(preview.includes("février 2027"));
});

test("saisie rapide : un seul calcul pour une rafale de frappes", async () => {
  const { get, modal, calls, context } = setup();
  modal.open(context);
  const before = calls.compute.length;
  typeInTotal(get, "1");
  typeInTotal(get, "12");
  typeInTotal(get, "120");
  await sleep(10);
  assert.equal(calls.compute.length, before + 1);
});

test("apercu : depassements restants avec leur raison en clair", async () => {
  const tasks = [...many(3, "ARMATURES", "2027-01-20")]; // mois en cours, rien n'avance
  const { get, modal, context } = setup({ tasks, context: { typesPresent: ["ARMATURES"] } });
  modal.open(context);
  typeInTotal(get, "2");
  await sleep(10);
  const preview = get("preview").innerHTML;
  assert.ok(preview.includes("1 dépassement reste"), preview);
  assert.ok(preview.includes("janvier 2027 — Total 3 / 2 : mois en cours"), preview);
  assert.ok(preview.includes("aucune tâche avancée"));
});

test("apercu : sans aucun maximum, rien n'est lisse", () => {
  const { get, modal, context } = setup();
  modal.open(context);
  assert.ok(get("preview").innerHTML.includes("Aucun maximum défini"));
});

test("apercu : les autres raisons sont traduites", async () => {
  // Tache realisee en trop : « tâches réalisées ».
  const tasks = [
    task("NDC", "2027-02-10", { realized: true }),
    task("NDC", "2027-02-11", { realized: true }),
    task("NDC", "2027-02-12"),
  ];
  const { get, modal, context } = setup({ tasks, context: { typesPresent: ["NDC"] } });
  modal.open(context);
  typeInTotal(get, "1");
  await sleep(10);
  assert.ok(get("preview").innerHTML.includes("tâches réalisées"), get("preview").innerHTML);
});

test("saisie invalide : champ marque, message, Enregistrer desactive, pas de calcul", async () => {
  const { get, modal, calls, context } = setup();
  modal.open(context);
  const before = calls.compute.length;
  const target = { dataset: { type: "COFFRAGE" }, value: "2,5", attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, removeAttribute(k) { delete this.attrs[k]; } };
  get("types").dispatch("input", { target });
  await sleep(10);
  assert.equal(target.attrs["aria-invalid"], "true");
  assert.ok(get("field-error").textContent.includes("nombre entier"));
  assert.equal(get("field-error").hidden, false);
  assert.equal(get("save").disabled, true);
  assert.equal(calls.compute.length, before);

  typeInTotal(get, "0");
  assert.equal(get("total").getAttribute("aria-invalid"), "true");

  // Correction : le champ redevient valide.
  target.value = "2";
  get("types").dispatch("input", { target });
  typeInTotal(get, "");
  assert.equal(target.attrs["aria-invalid"], undefined);
  assert.equal(get("total").getAttribute("aria-invalid"), null);
  assert.equal(get("save").disabled, false);
  assert.equal(get("field-error").hidden, true);
});

test("Enregistrer : onSubmit recoit { maxTotal, maxByType } puis la fenetre se ferme", async () => {
  const { root, get, modal, calls, context } = setup();
  modal.open(context);
  typeInTotal(get, "4");
  typeInTypeRow(get, "COFFRAGE", "2");
  typeInTypeRow(get, "NDC", "");
  get("save").dispatch("click");
  await sleep(5);
  assert.deepEqual(calls.submit, [{ maxTotal: 4, maxByType: { COFFRAGE: 2 } }]);
  assert.equal(modal.isOpen(), false);
  assert.equal(root.style.display, "none");
});

test("Enregistrer en echec : la fenetre reste ouverte, la saisie est gardee, l'erreur s'affiche", async () => {
  const { get, modal, context } = setup({ submitResult: { ok: false, error: "Droits insuffisants." } });
  modal.open(context);
  typeInTotal(get, "4");
  get("save").dispatch("click");
  await sleep(5);
  assert.equal(modal.isOpen(), true);
  assert.equal(get("total").value, "4");
  assert.equal(get("feedback").textContent, "Droits insuffisants.");
  assert.equal(get("feedback").hidden, false);
  assert.equal(get("save").disabled, false, "on peut reessayer");
});

test("Enregistrer : une exception du controleur est affichee, pas propagee", async () => {
  const { root, get, context } = setup();
  const modal = createSmoothingModal(root, {
    compute: () => ({ active: false, tasks: [], movedCount: 0, overflows: [] }),
    onSubmit: async () => { throw new Error("réseau coupé"); },
    onDelete: async () => ({ ok: true }),
    debounceMs: 0,
  });
  modal.open(context);
  typeInTotal(get, "4");
  get("save").dispatch("click");
  await sleep(5);
  assert.equal(modal.isOpen(), true);
  assert.equal(get("feedback").textContent, "réseau coupé");
  modal.destroy();
});

test("Supprimer le lissage : visible seulement si saved, confirme puis appelle onDelete", async () => {
  const unsaved = setup();
  unsaved.modal.open(unsaved.context);
  assert.equal(unsaved.get("delete").hidden, true);

  const { get, modal, calls, context } = setup({ context: { saved: true, settings: { maxTotal: 3, maxByType: {} } } });
  modal.open(context);
  assert.equal(get("delete").hidden, false);

  confirmAnswer = false;
  confirmCalls = 0;
  get("delete").dispatch("click");
  await sleep(5);
  assert.equal(confirmCalls, 1);
  assert.equal(calls.del, 0);
  assert.equal(modal.isOpen(), true);

  confirmAnswer = true;
  get("delete").dispatch("click");
  await sleep(5);
  assert.equal(calls.del, 1);
  assert.equal(modal.isOpen(), false);
});

test("Supprimer en echec : erreur affichee, fenetre ouverte", async () => {
  const { get, modal, context } = setup({
    context: { saved: true },
    deleteResult: { ok: false, error: "Suppression refusée." },
  });
  confirmAnswer = true;
  modal.open(context);
  get("delete").dispatch("click");
  await sleep(5);
  assert.equal(modal.isOpen(), true);
  assert.equal(get("feedback").textContent, "Suppression refusée.");
});

test("lecture seule : champs desactives, Enregistrer et Supprimer masques, note affichee", async () => {
  const { get, modal, calls, context } = setup({
    context: { readOnly: true, saved: true, settings: { maxTotal: 4, maxByType: { COFFRAGE: 2 } } },
  });
  modal.open(context);
  assert.equal(get("total").disabled, true);
  assert.ok(get("types").innerHTML.includes(" disabled"));
  assert.equal(get("save").hidden, true);
  assert.equal(get("delete").hidden, true);
  assert.equal(get("readonly").hidden, false);
  assert.equal(
    get("readonly").textContent,
    "Lecture seule : le service affiché n'est pas votre service de rattachement."
  );
  // Un Enregistrer force ne fait rien.
  get("save").dispatch("click");
  await sleep(5);
  assert.equal(calls.submit.length, 0);
  // L'apercu de consultation est quand meme calcule.
  assert.ok(get("preview").innerHTML.includes("tâches avancées"));
});

test("hors lecture seule : la note est masquee", () => {
  const { get, modal, context } = setup();
  modal.open(context);
  assert.equal(get("readonly").hidden, true);
  assert.equal(get("total").disabled, false);
});

test("refresh : garde les valeurs tapees et recalcule l'apercu et les pics", async () => {
  const { get, modal, calls, context } = setup({ tasks: exampleA() });
  modal.open(context);
  typeInTotal(get, "4");
  typeInTypeRow(get, "COFFRAGE", "3");
  await sleep(10);
  const before = calls.compute.length;

  // Un collegue ajoute 3 coffrages en mai : nouveau pic.
  const fresh = [...exampleA(), ...many(6, "COFFRAGE", "2027-05-05")];
  modal.refresh({ tasks: fresh, todayIso: TODAY });
  assert.equal(get("total").value, "4");
  assert.ok(get("types").innerHTML.includes('value="3"'));
  assert.ok(get("types").innerHTML.includes("pic actuel 6 (mai 2027)"), get("types").innerHTML);
  assert.equal(calls.compute.length, before + 1);
  assert.deepEqual(calls.compute.at(-1), { maxTotal: 4, maxByType: { COFFRAGE: 3 } });
  assert.equal(modal.isOpen(), true);
});

test("refresh sur une fenetre fermee : sans effet", () => {
  const { modal, calls } = setup();
  modal.refresh({ tasks: [], todayIso: TODAY });
  assert.equal(calls.compute.length, 0);
});

test("Echap, Fermer et Annuler ferment sans rien enregistrer", () => {
  const { root, get, modal, calls, context } = setup();
  for (const closer of [
    () => document.fire("keydown", { key: "Escape" }),
    () => get("close").dispatch("click"),
    () => get("cancel").dispatch("click"),
    () => root.dispatch("click"),
  ]) {
    modal.open(context);
    typeInTotal(get, "4");
    closer();
    assert.equal(modal.isOpen(), false);
    assert.equal(root.style.display, "none");
  }
  assert.equal(calls.submit.length, 0);
  assert.equal(calls.del, 0);
});

test("Echap sans effet quand la fenetre est deja fermee ; destroy retire les ecouteurs", () => {
  const { root, modal, context } = setup();
  modal.open(context);
  modal.destroy();
  assert.equal(modal.isOpen(), false);
  root.style.display = "flex";
  document.fire("keydown", { key: "Escape" });
  assert.equal(root.style.display, "flex", "ecouteur retire");
});

test("texte venant des donnees : une raison inconnue est echappee dans l'apercu", async () => {
  const { root, get, context } = setup();
  const modal = createSmoothingModal(root, {
    compute: () => ({
      active: true,
      tasks: [],
      movedCount: 0,
      overflows: [{ month: "2027-01", series: "<i>S</i>", count: 3, max: 2, reason: "<img onerror=x>" }],
    }),
    onSubmit: async () => ({ ok: true }),
    onDelete: async () => ({ ok: true }),
    debounceMs: 0,
  });
  modal.open(context);
  const html = get("preview").innerHTML;
  assert.ok(html.includes("&lt;img onerror=x&gt;"), html);
  assert.ok(html.includes("&lt;i&gt;S&lt;/i&gt;"), html);
  assert.ok(!html.includes("<img"));
  assert.ok(!html.includes("<i>"));
  modal.destroy();
});

test("refresh : les lignes par type ne sont pas reconstruites, seuls les pics changent", () => {
  const { get, modal, context } = setup({ tasks: exampleA() });
  const types = get("types");
  let writes = 0;
  let html = "";
  Object.defineProperty(types, "innerHTML", {
    get: () => html,
    set: (value) => { writes += 1; html = value; },
  });
  const spans = [
    { dataset: { peakFor: "COFFRAGE" }, textContent: "" },
    { dataset: { peakFor: "NDC" }, textContent: "" },
  ];
  types.querySelectorAll = () => spans;
  modal.open(context);
  assert.equal(writes, 1);

  modal.refresh({ tasks: [...exampleA(), ...many(6, "COFFRAGE", "2027-05-05")], todayIso: TODAY });
  assert.equal(writes, 1, "le champ en cours de frappe n'est pas detruit");
  assert.equal(spans[0].textContent, "pic actuel 6 (mai 2027)");
  assert.equal(spans[1].textContent, "pic actuel 8 (avril 2027)");

  // Un type qui apparait : reconstruction complete.
  modal.refresh({ tasks: [...exampleA(), ...many(1, "COFFRAGE", "2027-05-05")], todayIso: TODAY });
  assert.equal(writes, 1);
  modal.open({ ...context, typesPresent: ["NDC"] });
  assert.equal(writes, 2);
});

test("un maximum enregistre pour un type sans tache est conserve a l'enregistrement", async () => {
  const { get, modal, calls, context } = setup({
    context: { settings: { maxTotal: null, maxByType: { COFFRAGE: 2, DEMOLITION: 3 } } }, // DEMOLITION : pas de ligne
  });
  modal.open(context);
  typeInTotal(get, "5");
  typeInTypeRow(get, "COFFRAGE", "4");
  get("save").dispatch("click");
  await sleep(5);
  assert.deepEqual(calls.submit, [{ maxTotal: 5, maxByType: { DEMOLITION: 3, COFFRAGE: 4 } }]);
  // L'apercu en tient compte aussi.
  assert.deepEqual(calls.compute.at(-1).maxByType.DEMOLITION, 3);
});

// index.html reste en cache sans le bloc #ps-smoothing-modal : la fenetre doit
// etre inerte, jamais lever d'exception — le controleur du lissage la cree au
// demarrage, et une exception laisserait tout le widget blanc.
test("balisage absent : fenetre inerte, aucune exception, aucun ecouteur", () => {
  const before = (documentListeners.get("keydown") || []).length;
  const computed = [];
  for (const rootEl of [null, undefined, {}]) {
    let modal = null;
    assert.doesNotThrow(() => {
      modal = createSmoothingModal(rootEl, { compute: (settings) => computed.push(settings) });
    });
    assert.doesNotThrow(() => {
      modal.open({ title: "Lissage", typesPresent: ["NDC"], tasks: exampleA(), todayIso: TODAY, settings: null });
      modal.refresh({ tasks: exampleA(), todayIso: TODAY });
      modal.close();
    });
    assert.equal(modal.isOpen(), false);
    assert.doesNotThrow(() => modal.destroy());
  }
  assert.equal((documentListeners.get("keydown") || []).length, before);
  assert.equal(computed.length, 0, "aucun apercu calcule sans fenetre");
});

// --- mois de depart et mois particuliers ---------------------------------------------

test("buildStartOptions : mois en cours d'abord, puis les mois passes jusqu'a 5 ans avant la premiere tache", () => {
  const tasks = [task("NDC", "2026-10-20"), task("NDC", "2027-03-05"), task("NDC", "2026-12-01")];
  const options = buildStartOptions(tasks, TODAY, "");
  assert.deepEqual(options.slice(0, 3), [
    { value: "", label: "Mois en cours (janvier 2027)" },
    { value: "2026-12", label: "décembre 2026" },
    { value: "2026-11", label: "novembre 2026" },
  ]);
  // Premiere echeance en octobre 2026 : jusqu'a octobre 2021, mois vides compris.
  assert.deepEqual(options.at(-1), { value: "2021-10", label: "octobre 2021" });
  assert.equal(options.length, 64);

  // Aucune tache passee : 5 ans avant le mois en cours.
  assert.equal(buildStartOptions([task("NDC", "2027-03-05")], TODAY, "").at(-1).value, "2022-01");
  assert.equal(buildStartOptions([], TODAY, "").length, 61);
  // Mois enregistre plus ancien que la plage : propose quand meme, a sa place.
  assert.equal(buildStartOptions([task("NDC", "2027-03-05")], TODAY, "2020-06").at(-1).value, "2020-06");
});

test("buildMonthChoices : du mois de depart au dernier mois d'echeance, sans les mois deja ajoutes", () => {
  const tasks = [task("NDC", "2026-11-05"), task("NDC", "2027-02-10"), task("NDC", "2027-04-20")];
  assert.deepEqual(buildMonthChoices(tasks, "2027-01", ["2027-03"]), [
    { value: "2027-01", label: "janvier 2027" },
    { value: "2027-02", label: "février 2027" },
    { value: "2027-04", label: "avril 2027" },
  ]);
  assert.deepEqual(buildMonthChoices(tasks, "2027-06", []), []);
});

test("computeTypePeaks et buildPreviewRows : a partir du mois de depart passe", () => {
  const tasks = [...many(2, "NDC", "2026-12-10"), ...many(3, "NDC", "2027-01-20")];
  assert.deepEqual(computeTypePeaks(tasks, "2026-12").NDC, { count: 3, monthKey: "2027-01" });
  const result = smoothTasks(tasks, { maxTotal: 2, maxByType: {}, startMonth: "2026-11" }, TODAY);
  // Decembre (2 -> 2) est plein et inchange : omis ; janvier passe une tache
  // en novembre, vide et passe.
  assert.deepEqual(
    buildPreviewRows(result, "2026-11").map((row) => [row.monthKey, row.before, row.after]),
    [["2026-11", 0, 1], ["2027-01", 3, 2]]
  );
});

const PAST_TASKS = () => [
  ...many(1, "NDC", "2026-11-10"),
  ...many(4, "NDC", "2027-01-20"),
  ...many(2, "COFFRAGE", "2027-04-12"),
];

// Saisie dans une case du tableau des mois particuliers (evenement delegue).
function cellTarget(month, series, value) {
  return {
    dataset: { month, series },
    value,
    attrs: {},
    setAttribute(name, text) {
      this.attrs[name] = text;
    },
    removeAttribute(name) {
      delete this.attrs[name];
    },
  };
}

test("open : mois de depart et mois particuliers enregistres affiches", () => {
  const { get, modal, context } = setup({
    full: true,
    tasks: PAST_TASKS(),
    context: {
      typesPresent: ["COFFRAGE", "NDC"],
      settings: {
        maxTotal: 4,
        maxByType: { NDC: 3 },
        startMonth: "2026-11",
        maxByMonth: { "2027-04": { maxTotal: 2, maxByType: { COFFRAGE: 1 } } },
      },
    },
  });
  modal.open(context);
  assert.equal(get("start").value, "2026-11");
  assert.ok(get("start").innerHTML.includes('<option value="2026-11" selected>novembre 2026</option>'), get("start").innerHTML);
  const grid = get("months").innerHTML;
  assert.ok(grid.includes("avril 2027"), grid);
  assert.ok(grid.includes("2 tâches prévues"), grid);
  assert.ok(/data-month="2027-04" data-series="TOTAL"[^>]*value="2"/.test(grid), grid);
  assert.ok(/data-month="2027-04" data-series="COFFRAGE"[^>]*value="1"/.test(grid), grid);
  // Case vide : la valeur de tous les mois en indication.
  assert.ok(/data-series="NDC"[^>]*placeholder="3"/.test(grid), grid);
  // Avril est deja ajoute : il n'est plus propose. Les mois passes depuis le
  // depart le sont, mais la liste s'ouvre sur le mois en cours.
  assert.ok(!get("month-select").innerHTML.includes('value="2027-04"'));
  assert.ok(get("month-select").innerHTML.includes('value="2026-11"'));
  assert.equal(get("month-select").value, "2027-01");
});

test("mois de depart : le changer relance l'apercu avec startMonth", async () => {
  const { get, modal, calls, context } = setup({
    full: true,
    tasks: PAST_TASKS(),
    context: { typesPresent: ["COFFRAGE", "NDC"], settings: { maxTotal: 2, maxByType: {} } },
  });
  modal.open(context);
  const start = get("start");
  start.value = "2026-11";
  start.dispatch("change");
  await sleep(10);
  assert.deepEqual(calls.compute.at(-1), { maxTotal: 2, maxByType: {}, startMonth: "2026-11" });
  const preview = get("preview").innerHTML;
  assert.ok(preview.includes("décembre 2026"), preview);
  assert.ok(preview.includes("2 tâches avancées"), preview);

  // Retour au mois en cours : plus de startMonth.
  start.value = "";
  start.dispatch("change");
  await sleep(10);
  assert.deepEqual(calls.compute.at(-1), { maxTotal: 2, maxByType: {} });
});

test("mois particuliers : ajouter un mois, le remplir, enregistrer", async () => {
  const { get, modal, calls, context } = setup({
    full: true,
    tasks: PAST_TASKS(),
    context: { typesPresent: ["COFFRAGE", "NDC"], settings: { maxTotal: 4, maxByType: {} } },
  });
  modal.open(context);
  assert.ok(get("months").innerHTML.includes("Aucun mois particulier"), get("months").innerHTML);
  get("month-select").value = "2027-01";
  get("month-add").dispatch("click");
  assert.ok(get("months").innerHTML.includes("janvier 2027"), get("months").innerHTML);
  assert.ok(!get("month-select").innerHTML.includes('value="2027-01"'), "plus proposé");

  get("months").dispatch("input", { target: cellTarget("2027-01", "TOTAL", "3") });
  get("months").dispatch("input", { target: cellTarget("2027-01", "NDC", "2") });
  await sleep(10);
  const expected = {
    maxTotal: 4,
    maxByType: {},
    maxByMonth: { "2027-01": { maxTotal: 3, maxByType: { NDC: 2 } } },
  };
  assert.deepEqual(calls.compute.at(-1), expected);
  get("save").dispatch("click");
  await sleep(5);
  assert.deepEqual(calls.submit.at(-1), expected);
});

test("mois particuliers : retirer un mois ; un mois laisse vide n'est pas enregistre", async () => {
  const { get, modal, calls, context } = setup({
    full: true,
    tasks: PAST_TASKS(),
    context: {
      typesPresent: ["COFFRAGE", "NDC"],
      settings: { maxTotal: 4, maxByType: {}, maxByMonth: { "2027-04": { maxTotal: 2, maxByType: {} } } },
    },
  });
  modal.open(context);
  get("month-select").value = "2027-01";
  get("month-add").dispatch("click"); // ajoute, laisse vide
  get("months").dispatch("click", { target: { dataset: { removeMonth: "2027-04" } } });
  assert.ok(!get("months").innerHTML.includes("avril 2027"), get("months").innerHTML);
  assert.ok(get("month-select").innerHTML.includes('value="2027-04"'), "de nouveau proposé");
  get("save").dispatch("click");
  await sleep(5);
  assert.deepEqual(calls.submit.at(-1), { maxTotal: 4, maxByType: {} });
});

test("mois particuliers : saisie invalide -> message et Enregistrer desactive", () => {
  const { get, modal, context } = setup({
    full: true,
    tasks: PAST_TASKS(),
    context: {
      typesPresent: ["NDC"],
      settings: { maxTotal: 4, maxByType: {}, maxByMonth: { "2027-01": { maxTotal: 2, maxByType: {} } } },
    },
  });
  modal.open(context);
  const target = cellTarget("2027-01", "TOTAL", "0");
  get("months").dispatch("input", { target });
  assert.equal(target.attrs["aria-invalid"], "true");
  assert.equal(get("save").disabled, true);
  assert.ok(get("field-error").textContent.includes("nombre entier"));
});

test("mois particuliers : un maximum enregistre pour un type sans colonne est conserve", async () => {
  const { get, modal, calls, context } = setup({
    full: true,
    tasks: PAST_TASKS(),
    context: {
      typesPresent: ["NDC"],
      settings: { maxTotal: 4, maxByType: {}, maxByMonth: { "2027-01": { maxTotal: null, maxByType: { DEMOLITION: 1 } } } },
    },
  });
  modal.open(context);
  get("save").dispatch("click");
  await sleep(5);
  assert.deepEqual(calls.submit.at(-1), {
    maxTotal: 4,
    maxByType: {},
    maxByMonth: { "2027-01": { maxTotal: null, maxByType: { DEMOLITION: 1 } } },
  });
});

test("lecture seule : mois de depart et mois particuliers desactives", () => {
  const { get, modal, context } = setup({
    full: true,
    tasks: PAST_TASKS(),
    context: {
      readOnly: true,
      typesPresent: ["NDC"],
      settings: { maxTotal: 4, maxByType: {}, maxByMonth: { "2027-01": { maxTotal: 2, maxByType: {} } } },
    },
  });
  modal.open(context);
  assert.equal(get("start").disabled, true);
  assert.equal(get("month-select").disabled, true);
  assert.equal(get("month-add").hidden, true);
  const grid = get("months").innerHTML;
  assert.ok(grid.includes(" disabled"), grid);
  assert.ok(!grid.includes("data-remove-month"), grid);
});

test("apercu : un mois passe plein de taches en retard a sa raison en clair", () => {
  const tasks = many(3, "NDC", "2026-11-20"); // en retard (mois passe, non realisees)
  const { get, modal, context } = setup({
    full: true,
    tasks,
    context: { typesPresent: ["NDC"], settings: { maxTotal: 2, maxByType: {}, startMonth: "2026-11" } },
  });
  modal.open(context);
  const preview = get("preview").innerHTML;
  assert.ok(preview.includes("novembre 2026 — Total 3 / 2 : tâches réalisées ou en retard"), preview);
});
