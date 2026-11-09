// Tests de la fenetre « Lissage des taches » (top/smoothingModal.js) : fonctions
// pures (computeTypePeaks, buildPreviewRows) puis controleur DOM simule a la main,
// dans le style de monthTasksModal.test.mjs.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildManualPlanRows,
  buildMonthChoices,
  buildPlanChoices,
  buildPreviewRows,
  buildStartOptions,
  computeTypePeaks,
  createSmoothingModal,
} from "../assets/js/top/smoothingModal.js";
import { smoothTasks } from "../assets/js/top/taskSmoothing.js";
import { TYPE_META } from "../assets/js/top/taskLabels.js";

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
let confirmMessage = "";
globalThis.window = {
  confirm(message) {
    confirmCalls += 1;
    confirmMessage = message;
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
  assert.equal(confirmMessage, "Supprimer le lissage de ce service (maximums et dates manuelles) ?");
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
  const target = cellTarget("2027-01", "TOTAL", "-1");
  get("months").dispatch("input", { target });
  assert.equal(target.attrs["aria-invalid"], "true");
  assert.equal(get("save").disabled, true);
  assert.ok(get("field-error").textContent.includes("nombre entier"));
  assert.ok(get("field-error").textContent.includes("0"), "le message dit que 0 est permis");
});

test("mois particuliers : 0 accepte (aucune tache ce mois-la), enregistre tel quel", async () => {
  const { get, modal, calls, context } = setup({
    full: true,
    tasks: PAST_TASKS(),
    context: {
      typesPresent: ["COFFRAGE", "NDC"],
      settings: { maxTotal: 4, maxByType: {}, maxByMonth: { "2027-01": { maxTotal: 2, maxByType: {} } } },
    },
  });
  modal.open(context);
  const total = cellTarget("2027-01", "TOTAL", "0");
  get("months").dispatch("input", { target: total });
  get("months").dispatch("input", { target: cellTarget("2027-01", "NDC", "0") });
  await sleep(10);
  assert.equal(total.attrs["aria-invalid"], undefined);
  assert.equal(get("save").disabled, false);
  const expected = {
    maxTotal: 4,
    maxByType: {},
    maxByMonth: { "2027-01": { maxTotal: 0, maxByType: { NDC: 0 } } },
  };
  assert.deepEqual(calls.compute.at(-1), expected);
  get("save").dispatch("click");
  await sleep(5);
  assert.deepEqual(calls.submit.at(-1), expected);
  // Rouvert : le 0 enregistre revient dans sa case, sans etre marque invalide.
  modal.open({ ...context, settings: expected, saved: true });
  const grid = get("months").innerHTML;
  assert.ok(/data-month="2027-01" data-series="TOTAL"[^>]*value="0"/.test(grid), grid);
  assert.ok(!/data-series="TOTAL"[^>]*value="0"[^>]*aria-invalid/.test(grid), grid);
});

test("maximum de tous les mois : 0 reste refuse", () => {
  const { get, modal, context } = setup();
  modal.open(context);
  typeInTotal(get, "0");
  assert.equal(get("total").getAttribute("aria-invalid"), "true");
  assert.equal(get("save").disabled, true);
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

// --- plan particulier : dates manuelles (spec 2026-11-09 §5) -----------------------

// Elements de la section « Plan particulier » (absents d'un index.html en cache).
const PLAN_IDS = ["plans-unavailable", "plans", "plan-select", "plan-add", "plan-browse"];

// Plan a rowId choisi (les tests visent des N° precis).
function plan(rowId, type, dueIso, over = {}) {
  return {
    rowId, id2: String(rowId), name: `Plan ${rowId}`, zone: "", groupe: "", groupKey: "", type, dueIso,
    realized: false, ...over,
  };
}

// Tableau « Plan particulier » VIVANT, comme dans un navigateur : chaque
// ecriture d'innerHTML recree les cases date ([data-manual-plan]) et les notes
// ([data-note-for]) qu'il contient, que querySelectorAll et querySelector
// rendent. Le controleur prend donc, comme dans un navigateur, le chemin « memes
// plans -> mise a jour en place » ; les tests lisent les cases elles-memes
// (valeur, borne, marque d'erreur), pas le HTML de leur creation. writes
// compte les reconstructions du tableau. (Le FakeElement de base reste sans
// querySelectorAll : les tests des types et des mois lisent leur innerHTML.)
function makeLivePlans(el) {
  let html = "";
  let inputs = [];
  let notes = [];
  const attrOf = (tag, name) => {
    const match = new RegExp(`\\s${name}="([^"]*)"`).exec(tag);
    return match ? match[1] : null;
  };
  const live = {
    writes: 0,
    input: (rowId) => inputs.find((node) => node.dataset.manualPlan === String(rowId)) || null,
    note: (rowId) => notes.find((node) => node.dataset.noteFor === String(rowId)) || null,
    rowIds: () => inputs.map((node) => node.dataset.manualPlan),
    values: () => Object.fromEntries(inputs.map((node) => [node.dataset.manualPlan, node.value])),
  };
  Object.defineProperty(el, "innerHTML", {
    get: () => html,
    set: (value) => {
      live.writes += 1;
      html = String(value);
      inputs = [...html.matchAll(/<input[^>]*data-manual-plan="[^"]*"[^>]*>/g)].map(([tag]) => {
        const node = new FakeElement();
        node.tagName = "INPUT";
        node.dataset = { manualPlan: attrOf(tag, "data-manual-plan") };
        node.value = attrOf(tag, "value") ?? "";
        node.min = attrOf(tag, "min") ?? "";
        node.disabled = /\sdisabled(?=[\s>])/.test(tag);
        if (attrOf(tag, "aria-invalid")) node.setAttribute("aria-invalid", attrOf(tag, "aria-invalid"));
        node.focus = () => {
          document.activeElement = node;
        };
        return node;
      });
      notes = [...html.matchAll(/data-note-for="([^"]*)">([^<]*)</g)].map(([, key, text]) => {
        const node = new FakeElement();
        node.dataset = { noteFor: key };
        node.textContent = text;
        return node;
      });
    },
  });
  el.querySelectorAll = (selector) => {
    if (selector.includes("data-manual-plan")) return inputs;
    if (selector.includes("data-note-for")) return notes;
    return [];
  };
  el.querySelector = (selector) => {
    const match = /data-manual-plan="([^"]*)"/.exec(selector);
    return match ? live.input(match[1]) : null;
  };
  return live;
}

// Faux selecteur « Choisir les plans » (injecte par createPicker) : il note ses
// appels. Son ecouteur d'Echap s'inscrit a sa creation (order "avant" : avant
// celui de la fenetre « Lissage ») ou a sa premiere ouverture ("apres") ;
// comme le vrai, il appelle preventDefault quand il se ferme sur Echap.
function fakePicker(order = "avant") {
  const state = { el: null, options: null, opened: false, opens: [], updates: [], closes: 0, destroyed: false };
  let registered = false;
  const onKey = (event) => {
    if (event.key !== "Escape" || !state.opened) return;
    event.preventDefault();
    state.opened = false;
    state.closes += 1;
  };
  const register = () => {
    if (registered) return;
    document.addEventListener("keydown", onKey);
    registered = true;
  };
  const create = (el, options) => {
    state.el = el;
    state.options = options;
    if (order === "avant") register();
    return {
      open(model) {
        state.opened = true;
        state.opens.push(model);
        if (order === "apres") register();
      },
      update(model) {
        state.updates.push(model);
      },
      close() {
        if (state.opened) state.closes += 1;
        state.opened = false;
      },
      isOpen: () => state.opened,
      destroy() {
        state.destroyed = true;
        document.removeEventListener("keydown", onKey);
      },
    };
  };
  return { state, create };
}

function escapeEvent() {
  return {
    key: "Escape",
    defaultPrevented: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
  };
}

function setupPlans(over = {}) {
  const { root, get } = buildRoot([...NEW_IDS, ...(over.noPlanMarkup ? [] : PLAN_IDS)]);
  const live = over.noPlanMarkup ? null : makeLivePlans(get("plans"));
  document.activeElement = null;
  const pickerEl = new FakeElement("ps-plan-pick-modal");
  const picker = fakePicker(over.order);
  const calls = { compute: [], submit: [] };
  const tasks = over.tasks;
  const modal = createSmoothingModal(root, {
    compute: (settings) => {
      calls.compute.push(settings);
      return smoothTasks(tasks, settings, TODAY);
    },
    onSubmit: async (settings) => {
      calls.submit.push(settings);
      return { ok: true };
    },
    onDelete: async () => ({ ok: true }),
    debounceMs: 0,
    pickerEl,
    createPicker: picker.create,
  });
  const context = {
    title: "Lissage des tâches — Projet X · Gros œuvre",
    subtitle: "Projet X · Gros œuvre",
    service: "Gros œuvre",
    typesPresent: [...new Set(tasks.map((item) => item.type))],
    tasks,
    todayIso: TODAY,
    settings: { maxTotal: null, maxByType: {} },
    saved: false,
    readOnly: false,
    manualDates: {},
    hasManualColumn: true,
    ...(over.context || {}),
  };
  return { root, get, modal, calls, context, tasks, picker, pickerEl, live };
}

// Frappe dans une case du tableau, comme au clavier : le focus y est, sa valeur
// change, l'evenement `input` remonte au tableau (ecouteur delegue).
function typeInPlan(get, live, rowId, value) {
  const input = live.input(rowId);
  assert.ok(input, `case du plan ${rowId} absente`);
  document.activeElement = input;
  input.value = value;
  get("plans").dispatch("input", { target: input });
  return input;
}

// Evenement force sur une case qui n'existe pas (lecture seule, colonne absente).
function planInput(rowId, value) {
  return {
    dataset: { manualPlan: String(rowId) },
    value,
    setAttribute() {},
    removeAttribute() {},
  };
}

test("buildManualPlanRows : tri par date manuelle (vides en dernier) puis ordre du graphique, plans realises exclus", () => {
  const tasks = [
    plan(1, "NDC", "2027-02-10"),
    plan(2, "NDC", "2027-02-11"),
    plan(3, "NDC", "2027-03-20"),
    plan(4, "COFFRAGE", "2027-03-01", { zone: "Zone A", groupe: "3" }),
    plan(7, "NDC", "2027-02-01", { realized: true }),
  ];
  const draftManual = { 1: "2027-05-01", 2: "", 3: "2027-03-05", 4: "2027-03-05", 7: "2027-04-01", 99: "2027-04-01" };
  const rows = buildManualPlanRows({ tasks, draftManual, result: null });
  // 3 et 4 a la meme date : l'ordre du graphique (echeance) departage.
  assert.deepEqual(rows.map((row) => row.rowId), [4, 3, 1, 2]);
  assert.deepEqual(rows[0], {
    rowId: 4,
    id2: "4",
    name: "Plan 4",
    place: "Zone A · Groupe 3",
    type: "COFFRAGE",
    typeLabel: TYPE_META.COFFRAGE.label,
    typeColor: TYPE_META.COFFRAGE.color,
    dueIso: "2027-03-01",
    value: "2027-03-05",
    note: "",
  });
  assert.equal(rows[3].value, "");
});

test("buildManualPlanRows : note « N mois plus tôt / plus tard / même mois », « après son armature N° … » pour un coffrage", () => {
  const tasks = [
    plan(6, "NDC", "2027-02-10"),
    plan(11, "NDC", "2027-02-20"),
    plan(12, "NDC", "2027-05-10"),
    plan(5, "COFFRAGE", "2027-03-01", { groupKey: "g1" }),
    plan(2, "ARMATURES", "2027-04-10", { groupKey: "g1" }),
    plan(8, "ARMATURES", "2027-06-10", { groupKey: "g1" }), // apres la date du coffrage
    plan(9, "ARMATURES", "2027-03-10", { groupKey: "g1", realized: true }), // realisee
    plan(10, "ARMATURES", "2027-03-10", { groupKey: "g2" }), // autre groupe
  ];
  const manualDates = { 5: "2027-05-10", 6: "2027-04-05", 11: "2027-02-03", 12: "2027-03-10" };
  const result = smoothTasks(tasks, { maxTotal: null, maxByType: {}, manualDates }, TODAY);
  const notes = Object.fromEntries(
    buildManualPlanRows({ tasks, draftManual: manualDates, result }).map((row) => [row.rowId, row.note])
  );
  assert.equal(notes[6], "2 mois plus tard");
  assert.equal(notes[11], "même mois");
  assert.equal(notes[12], "2 mois plus tôt");
  assert.equal(notes[5], "2 mois plus tard · après son armature N° 2");

  // Sans apercu : pas d'ecart, l'echeance de l'armature sert de date.
  const bare = Object.fromEntries(
    buildManualPlanRows({ tasks, draftManual: manualDates, result: null }).map((row) => [row.rowId, row.note])
  );
  assert.equal(bare[5], "après son armature N° 2");
  assert.equal(bare[6], "");
});

test("buildPlanChoices : plans non realises sans date manuelle, dans l'ordre des taches, « N° id2 — nom (zone) »", () => {
  const tasks = [
    plan(1, "NDC", "2027-02-10", { realized: true }),
    plan(2, "NDC", "2027-02-11"),
    plan(3, "COFFRAGE", "2027-03-01", { zone: "Zone A", name: " Voile R+2 " }),
    plan(4, "NDC", "2027-03-05"),
    plan(null, "NDC", "2027-03-06"),
  ];
  // 2 est deja dans la saisie (meme sans date) : plus propose.
  assert.deepEqual(buildPlanChoices(tasks, { 2: "" }), [
    { value: "3", label: "N° 3 — Voile R+2 (Zone A)" },
    { value: "4", label: "N° 4 — Plan 4" },
  ]);
});

test("plan particulier : open affiche une ligne par plan a date manuelle, la case porte la date", () => {
  const tasks = [
    plan(3, "NDC", "2027-03-15", { zone: "Zone A" }),
    plan(4, "COFFRAGE", "2027-04-20"),
    plan(5, "NDC", "2027-05-02"),
  ];
  const { get, modal, calls, context, live } = setupPlans({
    tasks,
    context: { manualDates: { 3: "2027-02-15", 4: "2027-04-01" } },
  });
  modal.open(context);
  assert.deepEqual(live.rowIds(), ["3", "4"]);
  assert.deepEqual(live.values(), { 3: "2027-02-15", 4: "2027-04-01" });
  assert.equal(live.input(3).min, "2027-01-10");
  const html = get("plans").innerHTML;
  assert.ok(html.includes("Échéance sans lissage") && html.includes("15/03/2027"), html);
  assert.ok(html.includes("Zone A"), html);
  assert.ok(html.includes('data-remove-plan="3"'), html);
  // Ecart de mois du dernier apercu, mis en place dans les notes.
  assert.equal(live.note(3).textContent, "1 mois plus tôt");
  assert.equal(live.note(4).textContent, "même mois");
  assert.equal(get("plans-unavailable").hidden, true);
  const select = get("plan-select").innerHTML;
  assert.ok(select.includes('value="5"') && !select.includes('value="3"'), select);
  assert.deepEqual(calls.compute.at(-1).manualDates, { 3: "2027-02-15", 4: "2027-04-01" });
  modal.destroy();
});

test("plan particulier : sans date, le tableau dit qu'aucun plan n'est particulier", () => {
  const { get, modal, context } = setupPlans({ tasks: [plan(3, "NDC", "2027-03-15")] });
  modal.open(context);
  assert.ok(
    get("plans").innerHTML.includes("Aucun plan particulier : le lissage place chaque plan lui-même."),
    get("plans").innerHTML
  );
  assert.equal(get("plan-select").value, "3");
  assert.equal(get("plan-add").disabled, false);
  modal.destroy();
});

test("plan particulier : ajouter un plan prend sa date lissee du dernier apercu ; Enregistrer transmet manualDates", async () => {
  // Maximum 1 en mars : 3 (le plus tot) est avance au 15/02.
  const tasks = [plan(3, "NDC", "2027-03-15"), plan(4, "NDC", "2027-03-20")];
  const { get, modal, calls, context, live } = setupPlans({
    tasks,
    context: { settings: { maxTotal: 1, maxByType: {} } },
  });
  modal.open(context);
  get("plan-select").value = "3";
  get("plan-add").dispatch("click");
  assert.equal(live.input(3).value, "2027-02-15");
  assert.equal(document.activeElement, live.input(3), "le curseur va dans la case de la ligne");
  assert.ok(!get("plan-select").innerHTML.includes('value="3"'), "plus proposé");
  await sleep(10);
  assert.deepEqual(calls.compute.at(-1).manualDates, { 3: "2027-02-15" });
  get("save").dispatch("click");
  await sleep(5);
  assert.deepEqual(calls.submit.at(-1), { maxTotal: 1, maxByType: {}, manualDates: { 3: "2027-02-15" } });
});

test("plan particulier : sans apercu calcule, un plan ajoute prend son echeance", () => {
  const { root, get, context, live } = setupPlans({ tasks: [plan(3, "NDC", "2027-03-15")] });
  const modal = createSmoothingModal(root, {
    compute: () => null,
    onSubmit: async () => ({ ok: true }),
    onDelete: async () => ({ ok: true }),
    debounceMs: 0,
    createPicker: fakePicker().create,
  });
  modal.open(context);
  get("plan-select").value = "3";
  get("plan-add").dispatch("click");
  assert.equal(live.input(3).value, "2027-03-15");
  modal.destroy();
});

test("plan particulier : un plan en retard ajoute prend la premiere date permise, jamais une date plus tot", async () => {
  // 3 est en retard (echeance passee, non realise) : sa date lissee reste le 20/11/2026.
  const tasks = [plan(3, "NDC", "2026-11-20"), plan(4, "NDC", "2027-03-15")];
  const { get, modal, calls, context, live } = setupPlans({ tasks });
  modal.open(context);
  get("plan-select").value = "3";
  get("plan-add").dispatch("click");
  assert.equal(live.input(3).value, "2027-01-10", "mois de depart = mois en cours : aujourd'hui");
  assert.equal(get("field-error").hidden, true);
  assert.equal(get("save").disabled, false);

  // Mois de depart passe : le 1er de ce mois.
  get("plans").dispatch("click", { target: { dataset: { removePlan: "3" } } });
  get("start").value = "2026-12";
  get("start").dispatch("change");
  await sleep(10);
  get("plan-select").value = "3";
  get("plan-add").dispatch("click");
  assert.equal(live.input(3).value, "2026-12-01");
  get("save").dispatch("click");
  await sleep(5);
  assert.deepEqual(calls.submit.at(-1), {
    maxTotal: null,
    maxByType: {},
    startMonth: "2026-12",
    manualDates: { 3: "2026-12-01" },
  });
});

test("plan particulier : retirer un plan l'enleve de manualDates et le propose de nouveau", async () => {
  const tasks = [plan(3, "NDC", "2027-03-15"), plan(4, "NDC", "2027-04-20")];
  const { get, modal, calls, context, live } = setupPlans({
    tasks,
    context: { manualDates: { 3: "2027-02-15", 4: "2027-04-01" } },
  });
  modal.open(context);
  get("plans").dispatch("click", { target: { dataset: { removePlan: "3" } } });
  assert.deepEqual(live.rowIds(), ["4"]);
  assert.ok(get("plan-select").innerHTML.includes('value="3"'), "de nouveau proposé");
  get("save").dispatch("click");
  await sleep(5);
  assert.deepEqual(calls.submit.at(-1).manualDates, { 4: "2027-04-01" });
});

test("plan particulier : case videe -> la ligne reste, sa date n'est pas enregistree", async () => {
  const tasks = [plan(3, "NDC", "2027-03-15"), plan(4, "NDC", "2027-04-20")];
  const { get, modal, calls, context, live } = setupPlans({
    tasks,
    context: { manualDates: { 3: "2027-02-15", 4: "2027-04-01" } },
  });
  modal.open(context);
  const input = typeInPlan(get, live, 3, "");
  await sleep(10);
  assert.equal(live.input(3), input, "la case n'est pas recreee");
  assert.equal(input.value, "");
  assert.deepEqual(live.rowIds(), ["3", "4"]);
  assert.equal(get("save").disabled, false);
  assert.deepEqual(calls.compute.at(-1).manualDates, { 4: "2027-04-01" });
  get("save").dispatch("click");
  await sleep(5);
  assert.deepEqual(calls.submit.at(-1).manualDates, { 4: "2027-04-01" });
});

test("plan particulier : une date trop tot affiche le message et desactive Enregistrer ; une date enregistree plus ancienne reste acceptee", async () => {
  const tasks = [plan(3, "NDC", "2027-03-15"), plan(4, "NDC", "2027-04-20")];
  const { get, modal, calls, context, live } = setupPlans({ tasks, context: { manualDates: { 4: "2026-12-01" } } });
  modal.open(context);
  assert.equal(get("save").disabled, false, "date enregistree plus ancienne, non modifiee : acceptee");
  assert.equal(get("field-error").hidden, true);

  get("plan-select").value = "3";
  get("plan-add").dispatch("click");
  const input = typeInPlan(get, live, 3, "2027-01-05");
  assert.equal(get("field-error").textContent, "Choisissez une date à partir du 10/01/2027.");
  assert.equal(get("field-error").hidden, false);
  assert.equal(get("save").disabled, true);
  assert.equal(input.getAttribute("aria-invalid"), "true");
  const computed = calls.compute.length;
  await sleep(10);
  assert.equal(calls.compute.length, computed, "pas d'apercu sur une saisie invalide");
  assert.equal(input.value, "2027-01-05", "la case en cours de frappe garde sa saisie");

  // Aujourd'hui est permis (mois de depart = mois en cours).
  typeInPlan(get, live, 3, "2027-01-10");
  assert.equal(get("save").disabled, false);
  assert.equal(input.getAttribute("aria-invalid"), null);

  // La date enregistree, modifiee, doit respecter la borne ; remise a l'identique, elle repasse.
  typeInPlan(get, live, 4, "2026-12-02");
  assert.equal(get("save").disabled, true);
  typeInPlan(get, live, 4, "2026-12-01");
  assert.equal(get("save").disabled, false);

  // Mois de depart passe : permis a partir du 1er de ce mois ; la borne des cases suit.
  get("start").value = "2026-11";
  get("start").dispatch("change");
  assert.equal(input.min, "2026-11-01");
  typeInPlan(get, live, 3, "2026-10-31");
  assert.equal(get("field-error").textContent, "Choisissez une date à partir du 01/11/2026.");
  typeInPlan(get, live, 3, "2026-11-01");
  assert.equal(get("save").disabled, false);

  get("save").dispatch("click");
  await sleep(5);
  assert.deepEqual(calls.submit.at(-1), {
    maxTotal: null,
    maxByType: {},
    startMonth: "2026-11",
    manualDates: { 3: "2026-11-01", 4: "2026-12-01" },
  });
});

test("plan particulier : colonne absente -> message, controles desactives, tableau vide, pas de manualDates", async () => {
  const { get, modal, calls, context, picker } = setupPlans({
    tasks: [plan(3, "NDC", "2027-03-15")],
    context: { hasManualColumn: false, settings: { maxTotal: 2, maxByType: {} } },
  });
  modal.open(context);
  assert.equal(get("plans-unavailable").hidden, false);
  assert.equal(get("plans").innerHTML, "");
  assert.equal(get("plan-select").disabled, true);
  assert.equal(get("plan-add").disabled, true);
  assert.equal(get("plan-browse").disabled, true);
  get("plan-select").value = "3";
  get("plan-add").dispatch("click");
  get("plan-browse").dispatch("click");
  get("plans").dispatch("input", { target: planInput(3, "2027-05-01") });
  assert.equal(picker.state.opens.length, 0);
  assert.equal(get("plans").innerHTML, "");
  assert.ok(!("manualDates" in calls.compute.at(-1)), JSON.stringify(calls.compute.at(-1)));
  get("save").dispatch("click");
  await sleep(5);
  assert.deepEqual(calls.submit.at(-1), { maxTotal: 2, maxByType: {} });
});

test("plan particulier : la date d'un plan realise ou absent n'est ni listee ni verifiee, et reste dans manualDates", async () => {
  const tasks = [plan(3, "NDC", "2027-03-15"), plan(7, "NDC", "2027-02-01", { realized: true })];
  const saved = { 7: "2026-06-01", 99: "2027-05-05" };
  const { get, modal, calls, context, live } = setupPlans({ tasks, context: { manualDates: saved } });
  modal.open(context);
  assert.deepEqual(live.rowIds(), []);
  assert.ok(get("plans").innerHTML.includes("Aucun plan particulier"), get("plans").innerHTML);
  assert.ok(!get("plan-select").innerHTML.includes('value="7"'), "un plan realise n'est pas propose");
  assert.equal(get("save").disabled, false, "une date non affichee n'est pas verifiee");
  get("save").dispatch("click");
  await sleep(5);
  assert.deepEqual(calls.submit.at(-1).manualDates, saved);
});

test("plan particulier : balisage de la section absent (index.html en cache) -> les dates enregistrees sont gardees", async () => {
  const { get, modal, calls, context } = setupPlans({
    noPlanMarkup: true,
    tasks: [plan(3, "NDC", "2027-03-15")],
    context: { manualDates: { 3: "2027-02-15" } },
  });
  assert.doesNotThrow(() => modal.open(context));
  assert.deepEqual(calls.compute.at(-1).manualDates, { 3: "2027-02-15" });
  get("save").dispatch("click");
  await sleep(5);
  assert.deepEqual(calls.submit.at(-1), { maxTotal: null, maxByType: {}, manualDates: { 3: "2027-02-15" } });
  modal.destroy();
});

test("Choisir dans la liste… : ouvre le selecteur ; un changement de date suit dans la section, l'apercu et le selecteur", async () => {
  const tasks = [plan(3, "NDC", "2027-03-15"), plan(4, "NDC", "2027-03-20"), plan(7, "NDC", "2027-02-01", { realized: true })];
  const { get, modal, calls, context, picker, pickerEl, live } = setupPlans({
    tasks,
    context: { manualDates: { 4: "2027-04-02" } },
  });
  modal.open(context);
  assert.equal(picker.state.el, pickerEl);
  assert.equal(picker.state.options.idPrefix, "ps-plan-pick");
  assert.equal(typeof picker.state.options.onManualDateChange, "function");

  get("plan-browse").dispatch("click");
  assert.equal(picker.state.opens.length, 1);
  const model = picker.state.opens[0];
  assert.equal(model.subtitle, "Projet X · Gros œuvre");
  assert.equal(model.service, "Gros œuvre");
  assert.equal(model.active, true, "une date manuelle seule rend le lissage actif");
  assert.deepEqual(model.manual, { dates: { 4: "2027-04-02" }, minIso: "2027-01-10", readOnly: false });
  assert.deepEqual(model.entries.map((entry) => entry.rowId), [3, 4, 7]);
  assert.equal(model.entries.find((entry) => entry.rowId === 4).manual, true);

  // Un plan sans ligne : la ligne apparait avec sa date.
  const computed = calls.compute.length;
  const updates = picker.state.updates.length;
  picker.state.options.onManualDateChange(3, "2027-02-25");
  assert.equal(live.input(3).value, "2027-02-25");
  assert.ok(!get("plan-select").innerHTML.includes('value="3"'));
  await sleep(10);
  assert.equal(calls.compute.length, computed + 1);
  assert.deepEqual(calls.compute.at(-1).manualDates, { 3: "2027-02-25", 4: "2027-04-02" });
  assert.ok(picker.state.updates.length > updates, "le selecteur recoit update");
  const updated = picker.state.updates.at(-1);
  assert.deepEqual(updated.manual.dates, { 3: "2027-02-25", 4: "2027-04-02" });
  assert.equal(updated.entries.find((entry) => entry.rowId === 3).smoothedIso, "2027-02-25");

  // Un plan deja affiche : sa case suit, en place (memes plans, pas de reconstruction).
  const cell4 = live.input(4);
  const writes = live.writes;
  picker.state.options.onManualDateChange(4, "2027-05-05");
  assert.equal(live.writes, writes, "memes plans : le tableau n'est pas reconstruit");
  assert.equal(cell4.value, "2027-05-05", "la case de la section suit la date du selecteur");
  await sleep(10);
  assert.equal(live.note(4).textContent, "2 mois plus tard");

  // ✕, ou date en cours de frappe : la case se vide, la ligne reste.
  picker.state.options.onManualDateChange(4, "");
  assert.equal(live.input(4), cell4);
  assert.equal(cell4.value, "", "la case de la section se vide");
  await sleep(10);
  assert.deepEqual(picker.state.updates.at(-1).manual.dates, { 3: "2027-02-25" });

  // Enregistrer (la fenetre se ferme) : le selecteur se ferme aussi.
  get("save").dispatch("click");
  await sleep(5);
  assert.deepEqual(calls.submit.at(-1).manualDates, { 3: "2027-02-25" });
  assert.equal(modal.isOpen(), false);
  assert.equal(picker.state.opened, false, "close ferme aussi le selecteur");
  modal.destroy();
  assert.equal(picker.state.destroyed, true, "destroy detruit aussi le selecteur");
});

test("Choisir dans la liste… : sans lissage actif, les plans viennent du contexte", () => {
  const tasks = [plan(3, "NDC", "2027-03-15"), plan(4, "NDC", "2027-03-20")];
  const { get, modal, context, picker } = setupPlans({ tasks });
  modal.open(context);
  get("plan-browse").dispatch("click");
  const model = picker.state.opens.at(-1);
  assert.equal(model.active, false);
  assert.deepEqual(model.entries.map((entry) => [entry.rowId, entry.smoothedIso]), [[3, null], [4, null]]);
  assert.deepEqual(model.manual.dates, {});
  modal.destroy();
});

for (const order of ["avant", "apres"]) {
  test(`Echap avec « Choisir les plans » ouverte : seule celle-ci se ferme (son ecouteur ${order} celui du lissage)`, () => {
    const { get, modal, context, picker } = setupPlans({ tasks: [plan(3, "NDC", "2027-03-15")], order });
    modal.open(context);
    get("plan-browse").dispatch("click");
    assert.equal(picker.state.opened, true);
    document.fire("keydown", escapeEvent());
    assert.equal(picker.state.opened, false, "le selecteur se ferme");
    assert.equal(modal.isOpen(), true, "la fenetre « Lissage » reste ouverte");
    document.fire("keydown", escapeEvent());
    assert.equal(modal.isOpen(), false, "un second Echap ferme la fenetre « Lissage »");
    modal.destroy();
  });
}

test("apercu : resume avec les dates manuelles et une date en retard", () => {
  // 3 : date manuelle apres son echeance (retardee) ; 4 : plus tot, meme mois.
  const tasks = [plan(3, "NDC", "2027-02-10"), plan(4, "NDC", "2027-03-10"), plan(5, "NDC", "2027-03-12")];
  const { get, modal, context } = setupPlans({ tasks, context: { manualDates: { 3: "2027-04-05", 4: "2027-03-01" } } });
  modal.open(context);
  const preview = get("preview").innerHTML;
  assert.ok(preview.includes("aucune tâche avancée · 2 dates manuelles · 1 retardée par une date manuelle"), preview);
  modal.open({ ...context, manualDates: { 4: "2027-03-01" } });
  assert.ok(
    get("preview").innerHTML.includes("aucune tâche avancée · 1 date manuelle · aucune tâche retardée"),
    get("preview").innerHTML
  );
  modal.destroy();
});

test("apercu : pluriels des dates manuelles et des retards", () => {
  const { root, get, context } = setupPlans({ tasks: [plan(3, "NDC", "2027-03-15")] });
  const modal = createSmoothingModal(root, {
    compute: () => ({ active: true, tasks: [], movedCount: 2, manualCount: 3, delayedCount: 2, overflows: [] }),
    onSubmit: async () => ({ ok: true }),
    onDelete: async () => ({ ok: true }),
    debounceMs: 0,
    createPicker: fakePicker().create,
  });
  modal.open(context);
  assert.ok(
    get("preview").innerHTML.includes("2 tâches avancées · 3 dates manuelles · 2 retardées par une date manuelle"),
    get("preview").innerHTML
  );
  modal.destroy();
});

test("plan particulier : lecture seule -> cases desactivees, ligne d'ajout masquee sauf « Choisir dans la liste… » (selecteur en lecture seule)", async () => {
  const tasks = [plan(3, "NDC", "2027-03-15"), plan(4, "NDC", "2027-04-20")];
  const { get, modal, calls, context, picker, live } = setupPlans({
    tasks,
    context: { readOnly: true, manualDates: { 3: "2027-02-15" } },
  });
  modal.open(context);
  assert.equal(live.input(3).disabled, true);
  assert.ok(!get("plans").innerHTML.includes("data-remove-plan"), get("plans").innerHTML);
  assert.equal(get("plan-select").hidden, true);
  assert.equal(get("plan-add").hidden, true);
  assert.equal(get("plan-browse").hidden, false);
  assert.equal(get("plan-browse").disabled, false);

  // Saisies forcees : ignorees.
  get("plans").dispatch("input", { target: planInput(3, "2027-05-01") });
  get("plans").dispatch("click", { target: { dataset: { removePlan: "3" } } });
  get("plan-select").value = "4";
  get("plan-add").dispatch("click");
  get("plan-browse").dispatch("click");
  assert.equal(picker.state.opens.at(-1).manual.readOnly, true);
  picker.state.options.onManualDateChange(3, "2027-06-01");
  await sleep(10);
  assert.deepEqual(live.values(), { 3: "2027-02-15" });
  assert.deepEqual(calls.compute.at(-1).manualDates, { 3: "2027-02-15" });
  modal.destroy();
});

test("plan particulier : refresh({ manualDates }) -> plans non touches mis a jour, plans touches gardes", async () => {
  const tasks = [
    plan(3, "NDC", "2027-03-15"),
    plan(4, "NDC", "2027-04-20"),
    plan(5, "NDC", "2027-05-20"),
    plan(6, "NDC", "2027-06-20"),
    plan(8, "NDC", "2027-07-20"),
  ];
  const { get, modal, calls, context, live } = setupPlans({
    tasks,
    context: { manualDates: { 3: "2027-02-15", 4: "2027-04-01", 5: "2027-05-01", 8: "2027-07-01" } },
  });
  modal.open(context);
  typeInPlan(get, live, 3, "2027-03-01"); // touche (modifie)
  document.activeElement = null; // le focus part sur « Retirer »
  get("plans").dispatch("click", { target: { dataset: { removePlan: "5" } } }); // touche (retire)
  await sleep(10);

  // Un collegue enregistre d'autres dates : 4 change, 6 apparait, 8 disparait.
  const computed = calls.compute.length;
  modal.refresh({
    tasks,
    todayIso: TODAY,
    manualDates: { 3: "2027-02-20", 4: "2027-04-09", 5: "2027-05-09", 6: "2027-06-06" },
  });
  assert.equal(calls.compute.length, computed + 1, "l'apercu est relance");
  const expected = { 3: "2027-03-01", 4: "2027-04-09", 6: "2027-06-06" };
  assert.deepEqual(calls.compute.at(-1).manualDates, expected);
  assert.deepEqual(live.values(), expected);
  assert.ok(get("plan-select").innerHTML.includes('value="8"'), "de nouveau proposé");

  // Un refresh sans manualDates ne touche pas a la saisie.
  modal.refresh({ tasks, todayIso: TODAY });
  assert.deepEqual(calls.compute.at(-1).manualDates, expected);

  get("save").dispatch("click");
  await sleep(5);
  assert.deepEqual(calls.submit.at(-1).manualDates, expected);

  // Reouverture : plus rien n'est touche, les nouvelles dates s'appliquent toutes.
  modal.open({ ...context, manualDates: { 3: "2027-02-15" } });
  modal.refresh({ tasks, todayIso: TODAY, manualDates: { 3: "2027-02-22" } });
  assert.deepEqual(calls.compute.at(-1).manualDates, { 3: "2027-02-22" });
  assert.deepEqual(live.values(), { 3: "2027-02-22" });
  modal.destroy();
});

test("plan particulier : refresh({ manualDates }) sur les memes plans -> les cases non touchees suivent en place, la case qui a le focus attend de le perdre", async () => {
  const tasks = [plan(3, "NDC", "2027-03-15"), plan(4, "NDC", "2027-04-20"), plan(5, "NDC", "2027-05-20")];
  const { get, modal, calls, context, live } = setupPlans({
    tasks,
    context: { manualDates: { 3: "2027-02-15", 4: "2027-04-01", 5: "2027-05-01" } },
  });
  modal.open(context);
  const [cell3, cell4, cell5] = [3, 4, 5].map((rowId) => live.input(rowId));
  // Le focus est dans la case de 5, sans frappe : 5 n'est pas touche.
  document.activeElement = cell5;
  const writes = live.writes;
  modal.refresh({ tasks, todayIso: TODAY, manualDates: { 3: "2027-02-20", 4: "2027-04-01", 5: "2027-05-09" } });
  assert.equal(live.writes, writes, "memes plans : le tableau n'est pas reconstruit");
  assert.equal(cell3.value, "2027-02-20", "une case non touchee prend la nouvelle date");
  assert.equal(cell4.value, "2027-04-01");
  assert.equal(cell5.value, "2027-05-01", "la case qui a le focus n'est pas reecrite");
  assert.deepEqual(calls.compute.at(-1).manualDates, { 3: "2027-02-20", 4: "2027-04-01", 5: "2027-05-09" });

  // Le focus quitte la case (focusout, document.activeElement pas encore change) : elle reprend la saisie.
  get("plans").dispatch("focusout", { target: cell5 });
  assert.equal(cell5.value, "2027-05-09");
  document.activeElement = null;

  // Une case touchee garde sa saisie ; une case non touchee suit encore.
  typeInPlan(get, live, 3, "2027-03-03");
  document.activeElement = null;
  modal.refresh({ tasks, todayIso: TODAY, manualDates: { 3: "2027-02-22", 4: "2027-04-04", 5: "2027-05-09" } });
  assert.equal(cell3.value, "2027-03-03");
  assert.equal(cell4.value, "2027-04-04");
  assert.equal(live.writes, writes);
  await sleep(10);
  get("save").dispatch("click");
  await sleep(5);
  assert.deepEqual(calls.submit.at(-1).manualDates, { 3: "2027-03-03", 4: "2027-04-04", 5: "2027-05-09" });
});

test("plan particulier : memes plans qu'au dernier rendu -> seules les notes changent, la case en cours de frappe reste", async () => {
  const tasks = [plan(3, "NDC", "2027-03-15"), plan(4, "NDC", "2027-04-20")];
  const { get, modal, context, live } = setupPlans({ tasks, context: { manualDates: { 3: "2027-02-15" } } });
  modal.open(context);
  assert.equal(live.writes, 1);
  assert.equal(live.note(3).textContent, "1 mois plus tôt");

  const input = typeInPlan(get, live, 3, "2027-04-10");
  await sleep(10);
  assert.equal(live.writes, 1, "la case en cours de frappe n'est pas detruite");
  assert.equal(live.input(3), input);
  assert.equal(input.value, "2027-04-10");
  assert.equal(live.note(3).textContent, "1 mois plus tard");
  assert.equal(input.min, "2027-01-10");
  document.activeElement = null;

  // Un plan ajoute : le tableau est reconstruit.
  get("plan-select").value = "4";
  get("plan-add").dispatch("click");
  assert.equal(live.writes, 2);
  modal.destroy();
});

test("balisage : section « Plan particulier » identique dans index.html et dev/harness.html, entre les mois particuliers et le message d'erreur", async () => {
  const fs = await import("node:fs");
  const read = (relative) => fs.readFileSync(new URL(relative, import.meta.url), "utf8");
  const slices = ["../index.html", "../dev/harness.html"].map((file) => {
    const source = read(file);
    const start = source.indexOf('<div id="ps-smoothing-modal"');
    const end = source.indexOf('<div id="ps-plan-pick-modal"');
    assert.ok(start > 0 && end > start, `fenetre « Lissage » introuvable dans ${file}`);
    return source.slice(start, end);
  });
  assert.equal(slices[1], slices[0], "le banc de dev montre exactement la fenetre « Lissage » de la page reelle");
  const html = slices[0];
  const positions = [
    'class="ps-smoothing-add-month"',
    '<h3 class="ps-smoothing-heading">Plan particulier</h3>',
    "Imposez la date de fin d'un plan en mode lissé. Il compte dans le maximum de son mois et les autres plans se lissent autour. L'échéance sans lissage ne change pas.",
    '<p id="ps-smoothing-plans-unavailable" class="ps-smoothing-hint" hidden>Ajoutez une colonne Date « Date_Manuel_Lissage » dans Planning_Projet pour imposer la date d\'un plan.</p>',
    '<div id="ps-smoothing-plans" class="ps-smoothing-plans"></div>',
    '<div class="ps-smoothing-add-plan">',
    '<select id="ps-smoothing-plan-select" class="ps-smoothing-select" aria-label="Plan à ajouter"></select>',
    'id="ps-smoothing-plan-add" type="button" class="ps-smoothing-add-btn">Ajouter ce plan</button>',
    'id="ps-smoothing-plan-browse" type="button" class="ps-smoothing-add-btn">Choisir dans la liste…</button>',
    'id="ps-smoothing-field-error"',
  ].map((needle) => {
    const index = html.indexOf(needle);
    assert.ok(index >= 0, `absent : ${needle}`);
    return index;
  });
  assert.deepEqual([...positions].sort((a, b) => a - b), positions, "ordre de la section");
});

test("buildPlanChoices : sans N° (id2 vide), l'etiquette ne commence pas par « N° — »", () => {
  const tasks = [plan(7, "NDC", "2027-03-05", { id2: "", name: "FONDATIONS", zone: "Z01" })];
  assert.deepEqual(buildPlanChoices(tasks, {}), [{ value: "7", label: "FONDATIONS (Z01)" }]);
});
