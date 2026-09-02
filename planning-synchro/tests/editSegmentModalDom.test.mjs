// Tests du VRAI controleur `createEditSegmentModal` : aucune reimplementation.
// Un DOM minimal (juste ce que le controleur touche) est installe sur globalThis,
// puis le module reel est importe et pilote par les memes gestes que l'utilisateur
// (clic Enregistrer, clic Fermer, Echap, clic sur le fond).
//
// POURQUOI CE FICHIER EXISTE : les tests de `editSegmentModal.test.mjs` ne
// couvrent que les fabriques pures (`createSubmitLock`, `createSubmitSession`).
// Elles peuvent rester parfaites pendant que le CABLAGE casse — c'est le cablage
// qui porte les defauts A (fenetre indefermable) et B (resolution tardive qui
// ecrase une autre session), et c'est lui qui est epingle ici.
//
// ISOLATION : le verrou et la session sont des singletons de module (ils doivent
// survivre au destroy()/re-creation d'un changement de projet). Chaque scenario
// reimporte donc le module avec une URL differente pour repartir d'un etat neuf.

import { test } from "node:test";
import assert from "node:assert/strict";

// --- DOM minimal -------------------------------------------------------------

class FakeClassList {
  constructor() {
    this.names = new Set();
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

class FakeElement {
  constructor(id = "") {
    this.id = id;
    this.textContent = "";
    this.hidden = false;
    this.style = {};
    this.classList = new FakeClassList();
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
  // La liste « Deja engage ce mois-ci » est construite par API DOM (et non par
  // innerHTML : les noms de projet viennent de Grist). Le faux DOM doit donc
  // savoir composer, sinon le rendu de cette liste reste hors de portee des
  // tests et son comportement de masquage n'est epingle nulle part.
  append(...nodes) {
    this.children.push(...nodes);
  }
  replaceChildren(...nodes) {
    this.children = [...nodes];
  }
}
class FakeInput extends FakeElement {
  constructor(id) {
    super(id);
    this.value = "";
  }
}
class FakeButton extends FakeElement {
  constructor(id) {
    super(id);
    this.disabled = false;
  }
}

globalThis.HTMLElement = FakeElement;
globalThis.HTMLInputElement = FakeInput;
globalThis.HTMLButtonElement = FakeButton;

const documentListeners = new Map();
globalThis.document = {
  createElement(tagName) {
    const element = new FakeElement("");
    element.tagName = String(tagName).toUpperCase();
    return element;
  },
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

// --- outillage ---------------------------------------------------------------

const MODULE_URL = new URL("../assets/js/bottom/editSegmentModal.js", import.meta.url).href;
let freshCounter = 0;

// Verrou et session vivant au niveau module, chaque scenario a besoin d'un
// module neuf : la chaine de requete casse le cache d'import de Node.
function loadFreshModule() {
  freshCounter += 1;
  return import(`${MODULE_URL}?fresh=${freshCounter}`);
}

function buildRoot() {
  const root = new FakeElement("ps-edit-segment-modal");
  root.children = [
    new FakeElement("ps-edit-segment-month-label"),
    new FakeElement("ps-edit-segment-worker-label"),
    new FakeInput("ps-edit-segment-effectif"),
    new FakeElement("ps-edit-segment-calculated-days"),
    new FakeElement("ps-edit-segment-feedback"),
    new FakeButton("ps-edit-segment-save"),
    new FakeButton("ps-edit-segment-cancel"),
    new FakeElement("ps-edit-segment-load"),
    new FakeElement("ps-edit-segment-load-track"),
    new FakeElement("ps-edit-segment-load-fill"),
    new FakeElement("ps-edit-segment-load-days"),
    new FakeElement("ps-edit-segment-load-message"),
    new FakeElement("ps-edit-segment-load-projects"),
    new FakeElement("ps-edit-segment-load-projects-list"),
  ];
  return root;
}

function deferred() {
  let settle = null;
  let fail = null;
  const promise = new Promise((resolve, reject) => {
    settle = resolve;
    fail = reject;
  });
  return { promise, resolve: settle, reject: fail };
}

// Laisse tourner les micro-taches (l'`await onSubmit(...)` du controleur).
const flush = async () => {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
};

// Delai de garde volontairement court : la suite ne doit pas durer 30 s.
const STALL_MS = 15;
const afterStall = () => new Promise((resolve) => setTimeout(resolve, STALL_MS + 25));

// Monte une fenetre reelle et rend de quoi la piloter.
async function mountModal({
  stallTimeoutMs = STALL_MS,
  onSubmit,
  allTimeSegmentRows = [],
  resolveProjectLabel,
} = {}) {
  const mod = await loadFreshModule();
  const root = buildRoot();
  const calls = [];
  let pending = null;

  const modal = mod.createEditSegmentModal(root, {
    stallTimeoutMs,
    getAllTimeSegmentRows: () => allTimeSegmentRows,
    resolveProjectLabel,
    onSubmit:
      onSubmit ||
      ((payload) => {
        calls.push(payload);
        pending = deferred();
        return pending.promise;
      }),
  });

  const el = (id) => root.querySelector(`#${id}`);
  return {
    mod,
    root,
    modal,
    calls,
    el,
    save: () => el("ps-edit-segment-save"),
    cancel: () => el("ps-edit-segment-cancel"),
    input: () => el("ps-edit-segment-effectif"),
    feedback: () => el("ps-edit-segment-feedback"),
    monthLabel: () => el("ps-edit-segment-month-label"),
    loadProjects: () => el("ps-edit-segment-load-projects"),
    // Une ligne de la liste = [libelle, jours], dans l'ordre affiche.
    loadProjectRows: () =>
      el("ps-edit-segment-load-projects-list").children.map((item) =>
        item.children.map((cell) => cell.textContent)
      ),
    pending: () => pending,
    clickSave: () => el("ps-edit-segment-save").dispatch("click"),
    remount: () =>
      mod.createEditSegmentModal(root, {
        stallTimeoutMs,
        onSubmit: (payload) => {
          calls.push(payload);
          pending = deferred();
          return pending.promise;
        },
      }),
  };
}

// --- DEFAUT A : la fenetre ne doit jamais devenir indefermable ---------------

test("controleur reel : pendant l'ecriture, la fenetre refuse toute fermeture", async () => {
  const h = await mountModal();
  h.modal.open({ segmentId: 41, monthKey: "2026-03", workerName: "Alice", effectif: 3 });
  h.input().value = "4";
  h.clickSave();
  await flush();

  assert.equal(h.calls.length, 1, "une ecriture est partie");
  assert.equal(h.save().disabled, true, "Enregistrer bloque");
  assert.equal(h.cancel().disabled, true, "Fermer bloque");
  assert.equal(h.root.classList.contains("is-submitting"), true);

  document.fire("keydown", { key: "Escape" });
  assert.equal(h.modal.isOpen(), true, "Echap refuse");
  h.root.dispatch("click", { target: h.root });
  assert.equal(h.modal.isOpen(), true, "clic sur le fond refuse");
  h.cancel().dispatch("click");
  assert.equal(h.modal.isOpen(), true, "Fermer refuse");

  h.pending().resolve({ ok: true });
  await flush();
  assert.equal(h.modal.isOpen(), false, "le succes ferme la fenetre");
  h.modal.destroy();
});

test("defaut A : passe le delai de garde, Echap ferme mais Enregistrer reste bloque", async () => {
  const h = await mountModal();
  h.modal.open({ segmentId: 41, monthKey: "2026-03", workerName: "Alice", effectif: 3 });
  h.input().value = "4";
  h.clickSave();
  await flush();
  await afterStall();

  assert.equal(h.feedback().textContent, h.mod.SUBMIT_STALL_MESSAGE, "l'etat est explique");
  assert.equal(h.save().disabled, true, "Enregistrer RESTE desactive : l'ecriture est en vol");
  assert.equal(h.cancel().disabled, false, "Fermer redevient cliquable");
  assert.equal(h.root.classList.contains("is-stalled"), true);
  assert.equal(h.root.classList.contains("is-submitting"), false);

  // Un clic force (clavier, DevTools) ne doit lancer AUCUNE seconde ecriture.
  h.clickSave();
  await flush();
  assert.equal(h.calls.length, 1, "aucune seconde ecriture apres expiration");

  document.fire("keydown", { key: "Escape" });
  assert.equal(h.modal.isOpen(), false, "DEFAUT A : Echap ferme enfin la fenetre");
  h.modal.destroy();
});

test("defaut A : une frappe n'efface pas le message d'ecriture bloquee", async () => {
  const h = await mountModal();
  h.modal.open({ segmentId: 41, monthKey: "2026-03", workerName: "Alice", effectif: 3 });
  h.input().value = "4";
  h.clickSave();
  await flush();
  await afterStall();

  h.input().value = "5";
  h.input().dispatch("input");
  assert.equal(
    h.feedback().textContent,
    h.mod.SUBMIT_STALL_MESSAGE,
    "sinon l'utilisateur perd la seule explication de l'etat"
  );
  h.modal.destroy();
});

// --- DEFAUT B : une resolution tardive ne pilote pas une autre session -------

test("defaut B : un succes tardif ne ferme pas la fenetre rouverte ailleurs", async () => {
  const h = await mountModal();
  h.modal.open({ segmentId: 41, monthKey: "2026-03", workerName: "Alice", effectif: 3 });
  h.input().value = "4";
  h.clickSave();
  await flush();
  const firstWrite = h.pending();
  await afterStall();
  h.modal.close();

  h.modal.open({ segmentId: 88, monthKey: "2026-07", workerName: "Bob", effectif: 2 });
  assert.equal(h.modal.isOpen(), true, "reouverture possible apres expiration");
  assert.equal(h.monthLabel().textContent, "Juillet 2026");
  assert.equal(h.save().disabled, true, "Enregistrer toujours bloque : le verrou tient");
  h.input().value = "6";
  h.feedback().textContent = "saisie en cours";

  firstWrite.resolve({ ok: true }); // la PREMIERE ecriture se regle enfin
  await flush();

  assert.equal(h.modal.isOpen(), true, "DEFAUT B : la fenetre rouverte n'est pas fermee");
  assert.equal(h.monthLabel().textContent, "Juillet 2026", "contexte intact");
  assert.equal(h.input().value, "6", "saisie intacte");
  assert.equal(h.feedback().textContent, "saisie en cours", "aucun message ecrase");
  assert.equal(h.save().disabled, false, "le verrou est quand meme relache");

  // Et l'ecriture de la session courante, elle, ferme bien la fenetre.
  h.clickSave();
  await flush();
  assert.equal(h.calls.length, 2, "la nouvelle ecriture part");
  assert.deepEqual(
    {
      id: h.calls[1].segmentId,
      month: h.calls[1].monthKey,
      effectif: h.calls[1].selection.effectifDays,
    },
    { id: 88, month: "2026-07", effectif: 6 },
    "avec le contexte de la session courante"
  );
  h.pending().resolve({ ok: true });
  await flush();
  assert.equal(h.modal.isOpen(), false, "sa propre resolution ferme la fenetre");
  h.modal.destroy();
});

test("defaut B : un rejet tardif n'affiche pas son message sur la session suivante", async () => {
  const h = await mountModal();
  const originalError = console.error;
  console.error = () => {};
  try {
    h.modal.open({ segmentId: 41, monthKey: "2026-03", workerName: "Alice", effectif: 3 });
    h.input().value = "4";
    h.clickSave();
    await flush();
    const firstWrite = h.pending();
    await afterStall();
    h.modal.close();
    h.modal.open({ segmentId: 88, monthKey: "2026-07", workerName: "Bob", effectif: 2 });
    h.feedback().textContent = "saisie en cours";

    firstWrite.reject(new Error("Grist injoignable"));
    await flush();

    assert.equal(h.feedback().textContent, "saisie en cours", "pas de message d'erreur perime");
    assert.equal(h.modal.isOpen(), true, "fenetre toujours ouverte");
    assert.equal(h.save().disabled, false, "verrou relache par le finally malgre le rejet");
  } finally {
    console.error = originalError;
  }
  h.modal.destroy();
});

test("defaut B : la fenetre restee ouverte est bien fermee par sa propre ecriture", async () => {
  const h = await mountModal();
  h.modal.open({ segmentId: 41, monthKey: "2026-03", workerName: "Alice", effectif: 3 });
  h.input().value = "4";
  h.clickSave();
  await flush();
  await afterStall();
  // L'utilisateur ne touche a rien : la session est toujours la sienne.
  h.pending().resolve({ ok: true });
  await flush();
  assert.equal(h.modal.isOpen(), false, "l'ecriture a fini par aboutir");
  h.modal.destroy();
});

test("le message d'ecriture bloquee est retracte quand le verrou est enfin rendu", async () => {
  const h = await mountModal();
  h.modal.open({ segmentId: 41, monthKey: "2026-03", workerName: "Alice", effectif: 3 });
  h.input().value = "4";
  h.clickSave();
  await flush();
  const firstWrite = h.pending();
  await afterStall();
  h.modal.close();
  h.modal.open({ segmentId: 88, monthKey: "2026-07", workerName: "Bob", effectif: 2 });
  assert.equal(
    h.feedback().textContent,
    h.mod.SUBMIT_STALL_MESSAGE,
    "la reouverture rappelle l'ecriture en vol"
  );

  firstWrite.resolve({ ok: true });
  await flush();

  assert.equal(h.feedback().textContent, "", "le message devenu faux disparait");
  assert.equal(h.save().disabled, false, "et le formulaire redevient utilisable");
  h.modal.destroy();
});

test("la retraction n'efface QUE le message d'ecriture bloquee", async () => {
  const h = await mountModal();
  h.modal.open({ segmentId: 41, monthKey: "2026-03", workerName: "Alice", effectif: 3 });
  h.input().value = "4";
  h.clickSave();
  await flush();
  const firstWrite = h.pending();
  await afterStall();
  h.modal.close();
  h.modal.open({ segmentId: 88, monthKey: "2026-07", workerName: "Bob", effectif: 2 });
  h.feedback().textContent = "saisie en cours";

  firstWrite.resolve({ ok: true });
  await flush();

  assert.equal(
    h.feedback().textContent,
    "saisie en cours",
    "un message qui n'est pas le sien est intact"
  );
  h.modal.destroy();
});

// --- Verrou partage : il doit survivre au demontage/remontage ----------------

test("verrou partage : un destroy()/re-creation ne rend pas un verrou neuf", async () => {
  // `main.js` appelle teardown() a chaque loadProject() : detach() ->
  // editSegmentModal.destroy(), puis attachChargeEditing() reconstruit une
  // fenetre. Avec un verrou par instance, ce cycle laissait partir un SECOND
  // AddRecord sur le meme (personne, mois) pendant que le premier etait en vol.
  const h = await mountModal({ stallTimeoutMs: 5000 });
  h.modal.open({ segmentId: null, monthKey: "2026-03", workerName: "Alice", effectif: "" });
  h.input().value = "4";
  h.clickSave();
  await flush();
  assert.equal(h.calls.length, 1, "1re ecriture partie (creation Alice / 2026-03)");

  h.modal.destroy(); // changement de projet
  const remounted = h.remount(); // attachChargeEditing() re-monte la fenetre
  remounted.open({ segmentId: null, monthKey: "2026-03", workerName: "Alice", effectif: "" });
  assert.equal(remounted.isOpen(), false, "la fenetre refuse de s'ouvrir : ecriture en vol");
  h.input().value = "4";
  h.clickSave();
  await flush();

  assert.equal(h.calls.length, 1, "aucun second AddRecord sur la meme cle metier");
  h.pending().resolve({ ok: true });
  await flush();
  remounted.destroy();
});

test("verrou partage : apres expiration, la fenetre remontee s'ouvre mais n'ecrit pas", async () => {
  const h = await mountModal();
  h.modal.open({ segmentId: null, monthKey: "2026-03", workerName: "Alice", effectif: "" });
  h.input().value = "4";
  h.clickSave();
  await flush();
  const firstWrite = h.pending();
  await afterStall();

  h.modal.destroy();
  const remounted = h.remount();
  remounted.open({ segmentId: null, monthKey: "2026-03", workerName: "Alice", effectif: "" });
  assert.equal(remounted.isOpen(), true, "delai expire : la fenetre redevient utilisable");
  assert.equal(h.save().disabled, true, "mais Enregistrer reste bloque, l'ecriture est en vol");
  h.input().value = "4";
  h.clickSave();
  await flush();
  assert.equal(h.calls.length, 1, "toujours aucun doublon");

  // La resolution tardive rend le verrou a la fenetre remontee.
  firstWrite.resolve({ ok: true });
  await flush();
  assert.equal(h.save().disabled, false, "le controleur remonte voit le verrou rendu");
  assert.equal(remounted.isOpen(), true, "et il n'est pas ferme de force (session renouvelee)");
  remounted.destroy();
});

test("verrou partage : destroy() pendant l'ecriture ne laisse pas le timer toucher un DOM mort", async () => {
  const h = await mountModal();
  h.modal.open({ segmentId: 41, monthKey: "2026-03", workerName: "Alice", effectif: 3 });
  h.input().value = "4";
  h.clickSave();
  await flush();

  h.modal.destroy(); // widget demonte pendant l'ecriture
  h.feedback().textContent = "temoin";
  await afterStall(); // le delai de garde expire APRES le demontage

  assert.equal(h.feedback().textContent, "temoin", "aucun controleur mort n'ecrit dans le DOM");
  // Le verrou, lui, a bien enregistre l'expiration : une fenetre remontee peut
  // s'ouvrir, sans quoi le widget resterait condamne jusqu'au rechargement.
  const remounted = h.remount();
  remounted.open({ segmentId: 41, monthKey: "2026-03", workerName: "Alice", effectif: 3 });
  assert.equal(remounted.isOpen(), true);
  h.pending().resolve({ ok: true });
  await flush();
  remounted.destroy();
});

// --- Non-regression du geste ------------------------------------------------

test("controleur reel : double-clic sur Enregistrer -> une seule ecriture", async () => {
  const h = await mountModal({ stallTimeoutMs: 5000 });
  h.modal.open({ segmentId: null, monthKey: "2026-03", workerName: "Alice", effectif: "" });
  h.input().value = "4";
  h.clickSave();
  h.clickSave();
  h.clickSave();
  await flush();
  assert.equal(h.calls.length, 1, "un seul AddRecord malgre le triple clic");
  h.pending().resolve({ ok: true });
  await flush();
  assert.equal(h.modal.isOpen(), false);
  h.modal.destroy();
});

test("controleur reel : la validation de l'effectif est inchangee", async () => {
  const h = await mountModal({ stallTimeoutMs: 5000 });
  h.modal.open({ segmentId: 41, monthKey: "2026-03", workerName: "Alice", effectif: 3 });

  h.input().value = "";
  h.clickSave();
  await flush();
  assert.equal(h.calls.length, 0);
  assert.match(h.feedback().textContent, /superieur a 0/);

  h.input().value = "1.25";
  h.clickSave();
  await flush();
  assert.equal(h.calls.length, 0);
  assert.match(h.feedback().textContent, /entier ou un multiple/);

  h.input().value = "1,5";
  h.clickSave();
  await flush();
  assert.equal(h.calls.length, 1, "la virgule francaise passe toujours");
  assert.equal(h.calls[0].selection.effectifValueForSave, 1.5);
  h.pending().resolve({ ok: true });
  await flush();
  h.modal.destroy();
});

test("controleur reel : un echec renvoye laisse la fenetre ouverte avec son message", async () => {
  const h = await mountModal({ stallTimeoutMs: 5000 });
  h.modal.open({ segmentId: 41, monthKey: "2026-03", workerName: "Alice", effectif: 3 });
  h.input().value = "4";
  h.clickSave();
  await flush();
  h.pending().resolve({ ok: false, error: "L'enregistrement du segment a echoue." });
  await flush();

  assert.equal(h.modal.isOpen(), true, "la fenetre reste ouverte pour corriger");
  assert.equal(h.feedback().textContent, "L'enregistrement du segment a echoue.");
  assert.equal(h.save().disabled, false, "et on peut re-essayer");
  h.modal.destroy();
});

// --- index.html et dev/harness.html : les MEMES fenetres -----------------------
//
// Le banc de developpement ne sert a rien s il montre un autre balisage que la
// page reelle : un identifiant renomme d un cote, une legende corrigee d un seul
// cote, et le banc valide une fenetre que personne n utilise. Les deux fichiers
// doivent porter la meme tranche de fenetre, octet pour octet.
//
// ETENDU EN TACHE 4 (charge de reference) : la fenetre d'assignation
// (#ps-charge-assign-modal, bottom/chargeAssignModal.js) est apparue a cote de
// celle de segment, avec la meme exigence — meme boucle, un prefixe de plus,
// aucun test parallele.

test("index.html et dev/harness.html portent des fenetres identiques", async () => {
  const fs = await import("node:fs");
  const read = (relative) => fs.readFileSync(new URL(relative, import.meta.url), "utf8");

  // Tranche de la fenetre : de la premiere a la derniere mention de son prefixe.
  const modalSlice = (source, prefix, label) => {
    const first = source.indexOf(prefix);
    assert.ok(first > 0, `fenetre ${prefix} introuvable dans ${label}`);
    const last = source.lastIndexOf(prefix);
    const start = source.lastIndexOf("<", first);
    const end = source.indexOf(String.fromCharCode(10), last);
    const slice = source.slice(start, end);
    assert.ok(slice.length > 500, `tranche de fenetre ${prefix} suspecte dans ${label}`);
    return slice;
  };

  const harness = read("../dev/harness.html");
  const index = read("../index.html");

  ["ps-edit-segment", "ps-charge-assign"].forEach((prefix) => {
    assert.equal(
      modalSlice(harness, prefix, "dev/harness.html"),
      modalSlice(index, prefix, "index.html"),
      `le banc de dev doit montrer exactement la fenetre ${prefix} de la page reelle`
    );
  });
});

// --- Liste « Deja engage ce mois-ci » ----------------------------------------
//
// Le detail par projet sous la barre. Le calcul appartient a utils/monthLoad.js
// (teste ailleurs) ; ce qui est epingle ici est le CABLAGE : la resolution du
// nom, le repli quand elle echoue, et le masquage de la section.

function segmentRow(id, projectNumber, effectif) {
  return {
    id,
    Mois: "2026-09-01",
    Name: "Marie Dupont",
    Effectif: effectif,
    NumeroProjet: projectNumber,
  };
}

const OPEN_SEPTEMBER = {
  segmentId: null,
  monthKey: "2026-09",
  workerName: "Marie Dupont",
  effectif: 3,
};

test("la liste nomme les projets et les classe du plus charge au moins charge", async () => {
  const names = { 252035: "CHU Nantes", 241102: "Pont de Chevire" };
  const harness = await mountModal({
    allTimeSegmentRows: [segmentRow(1, "241102", 4), segmentRow(2, "252035", 9)],
    resolveProjectLabel: (number) => names[number] || "",
  });

  harness.modal.open(OPEN_SEPTEMBER);

  assert.equal(harness.loadProjects().hidden, false);
  assert.deepEqual(harness.loadProjectRows(), [
    ["252035 · CHU Nantes", "9 j"],
    ["241102 · Pont de Chevire", "4 j"],
  ]);
});

test("un projet absent du catalogue s'affiche par son numero, il ne disparait pas", async () => {
  // Cas normal, pas une anomalie : le catalogue ne porte que les projets
  // visibles par cet utilisateur (service courant, ACL), alors que la charge se
  // compte tous projets confondus. Masquer la ligne ferait chercher des jours
  // manquants qui existent pourtant.
  const harness = await mountModal({
    allTimeSegmentRows: [segmentRow(1, "999999", 2)],
    resolveProjectLabel: () => "",
  });

  harness.modal.open(OPEN_SEPTEMBER);

  assert.deepEqual(harness.loadProjectRows(), [["999999", "2 j"]]);
});

test("un catalogue qui jette ne fait pas tomber la fenetre", async () => {
  const harness = await mountModal({
    allTimeSegmentRows: [segmentRow(1, "252035", 5)],
    resolveProjectLabel: () => {
      throw new Error("catalogue en cours de rechargement");
    },
  });

  harness.modal.open(OPEN_SEPTEMBER);

  assert.deepEqual(harness.loadProjectRows(), [["252035", "5 j"]]);
});

test("la section est masquee quand la personne n'a rien pose ailleurs", async () => {
  // Un titre « Deja engage ce mois-ci » sans aucune ligne vaudrait moins que rien.
  const harness = await mountModal({ allTimeSegmentRows: [] });

  harness.modal.open(OPEN_SEPTEMBER);

  assert.equal(harness.loadProjects().hidden, true);
  assert.deepEqual(harness.loadProjectRows(), []);
});

test("le segment en cours d'edition n'apparait pas dans la liste", async () => {
  // La liste repond a « ou sont ses jours EN DEHORS de ce que je suis en train
  // de saisir » : y voir le segment ouvert le compterait deux fois a l'oeil.
  const harness = await mountModal({
    allTimeSegmentRows: [segmentRow(7, "252035", 6), segmentRow(8, "241102", 4)],
    resolveProjectLabel: () => "",
  });

  harness.modal.open({ ...OPEN_SEPTEMBER, segmentId: 7, effectif: 6 });

  assert.deepEqual(harness.loadProjectRows(), [["241102", "4 j"]]);
});

test("la liste se vide quand la fenetre rouvre sur un mois illisible", async () => {
  // Sans ce nettoyage, le detail de la session precedente resterait a l'ecran
  // sous une barre effacee.
  const harness = await mountModal({
    allTimeSegmentRows: [segmentRow(1, "252035", 5)],
    resolveProjectLabel: () => "",
  });

  harness.modal.open(OPEN_SEPTEMBER);
  assert.equal(harness.loadProjectRows().length, 1);

  harness.modal.open({ ...OPEN_SEPTEMBER, monthKey: "bidon" });
  assert.equal(harness.loadProjects().hidden, true);
  assert.deepEqual(harness.loadProjectRows(), []);
});

test("une ligne sans numero de projet est nommee, jamais tue", async () => {
  // Ses jours comptent dans le total de la barre : les taire ferait chercher a
  // l'utilisateur un ecart entre la barre et son detail.
  const harness = await mountModal({
    allTimeSegmentRows: [segmentRow(1, "252035", 5), segmentRow(2, "", 2)],
    resolveProjectLabel: () => "",
  });

  harness.modal.open(OPEN_SEPTEMBER);

  assert.deepEqual(harness.loadProjectRows(), [
    ["252035", "5 j"],
    ["Projet non renseigne", "2 j"],
  ]);
});
