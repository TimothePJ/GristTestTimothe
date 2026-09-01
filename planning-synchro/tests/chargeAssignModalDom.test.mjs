// Tests du VRAI controleur `createChargeAssignModal` : aucune reimplementation.
// Meme technique que tests/editSegmentModalDom.test.mjs (DOM minimal installe
// sur globalThis, puis pilotage par les memes gestes que l'utilisateur), mais
// SANS le jeu de reimport `?fresh=N` : `sharedSubmitLock`/`sharedSubmitSession`
// vivent dans editSegmentModal.js et cette fenetre les importe par un
// specificateur statique ("./editSegmentModal.js") — un reimport versionne de
// chargeAssignModal.js ne changerait donc PAS l'instance du verrou qu'il capte
// (elle resterait la toute premiere copie chargee dans ce process). On importe
// donc les deux modules UNE FOIS, en tete de fichier, exactement comme le fait
// main.js en production (un seul verrou, partage par les deux fenetres tant
// que le process vit) — et chaque test nettoie apres lui (resout sa propre
// ecriture) pour ne rien laisser en vol au test suivant.
//
// CE QUI EST COUVERT ICI (le reste — depliage par zone/document — est verifie
// par relecture structurelle, comme createChargeBoard() dans
// bottom/chargeBoard.js : cf. task-3-report.md) :
//   - double-clic -> une seule ecriture (meme defaut qu'editSegmentModal) ;
//   - le verrou est REELLEMENT partage : une ecriture de charge en vol
//     empeche la fenetre de segment de s'ouvrir, et reciproquement ;
//   - le mirroir local du delai de garde (note "VERROU PARTAGE" du fichier
//     source) debloque bien Fermer sans debloquer Enregistrer ;
//   - un echec renvoye laisse la fenetre ouverte avec son message ;
//   - vider un champ qui avait sa propre valeur transmet bien fields:"" a
//     onSubmit (chemin complet handleFieldChange -> buildEditsTree ->
//     collectChargeWrites) ;
//   - FIX ROUND 1 : un segment qui cale, se ferme, puis une fenetre de charge
//     ouverte a la place, se debloque bien a la resolution tardive du segment
//     (Important 1 — repro complet de la brief) ;
//   - FIX ROUND 1 : un champ herite rend bien value="" / data-original="" et
//     ne montre la valeur heritee QUE dans le placeholder (Important 4 — un
//     rendu qui figerait le defaut dans `value` passait toute la suite avant
//     ce test) ;
//   - FIX ROUND 1 : la banniere de divergence accorde diverge/divergent et
//     tronque la liste d'IDs au-dela de 5 (minor) ;
//   - FIX ROUND 1 : fermer avec des editions en attente demande confirmation,
//     fermer une fenetre non modifiee n'en demande jamais (minor).

import { test } from "node:test";
import assert from "node:assert/strict";

import { createEditSegmentModal, SUBMIT_STALL_MESSAGE } from "../assets/js/bottom/editSegmentModal.js";
import { createChargeAssignModal } from "../assets/js/bottom/chargeAssignModal.js";

// --- DOM minimal (identique en esprit a editSegmentModalDom.test.mjs) --------

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
    this.innerHTML = "";
    this.hidden = false;
    this.style = {};
    this.dataset = {};
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
}
class FakeInput extends FakeElement {
  constructor(id) {
    super(id);
    this.value = "";
    // `validity.badInput` d'un <input type="number"> : « l'utilisateur a fourni
    // une saisie que l'agent utilisateur ne sait pas convertir ». C'est le SEUL
    // signal qui separe un champ efface (`.value === ""`, intention d'ecrire "")
    // d'un champ mal tape (`.value === ""` aussi — l'UA vide la valeur), et dans
    // cette fenetre "" est une valeur qui s'ecrit.
    this.validity = { badInput: false };
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

// --- outillage -----------------------------------------------------------------

function buildChargeAssignRoot() {
  const root = new FakeElement("ps-charge-assign-modal");
  root.children = [
    new FakeElement("ps-charge-assign-body"),
    new FakeElement("ps-charge-assign-feedback"),
    new FakeButton("ps-charge-assign-save"),
    new FakeButton("ps-charge-assign-cancel"),
  ];
  return root;
}

function buildEditSegmentRoot() {
  const root = new FakeElement("ps-edit-segment-modal");
  root.children = [
    new FakeElement("ps-edit-segment-month-label"),
    new FakeElement("ps-edit-segment-worker-label"),
    new FakeInput("ps-edit-segment-effectif"),
    new FakeElement("ps-edit-segment-calculated-days"),
    new FakeElement("ps-edit-segment-feedback"),
    new FakeButton("ps-edit-segment-save"),
    new FakeButton("ps-edit-segment-cancel"),
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

const flush = async () => {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
};

// Delai de garde volontairement court, mais large : deux timers CHAINES
// (celui du verrou partage, puis le mirroir local a delay+1, cf. fix round 1)
// doivent tous les deux avoir eu le temps de se declencher avant l'assertion.
// 15 ms + une marge de 25 ms s'est deja avere trop juste sous Windows (defaut
// signale en fix round 1) : marges nettement plus genereuses ici.
const STALL_MS = 60;
const afterStall = () => new Promise((resolve) => setTimeout(resolve, STALL_MS + 150));

// Stub controlable de `confirm` (utilise par la garde de fermeture avec
// editions en attente, cf. fix round 1, minor). Chaque test qui l'exerce
// reinitialise `confirmCalls`/`confirmReturnValue`.
let confirmCalls = [];
let confirmReturnValue = true;
globalThis.confirm = (message) => {
  confirmCalls.push(message);
  return confirmReturnValue;
};

const COLS = {
  id: "id",
  id2: "ID2",
  typeDoc: "Type_doc",
  zone: "Zone",
  taskName: "Taches",
  taskNameAlt: "Tache",
  dureeProjet: "Duree_Projet",
  dureeZone: "Duree_Zone",
  dureeForce: "Duree_Force",
};

const ONE_ROW = [{ id: 20, ID2: "3001", Type_doc: "COFFRAGE", Zone: "Zone 1" }];

function mountChargeAssign({ stallTimeoutMs = STALL_MS, onSubmit } = {}) {
  const root = buildChargeAssignRoot();
  const calls = [];
  let pending = null;

  const modal = createChargeAssignModal(root, {
    stallTimeoutMs,
    onSubmit:
      onSubmit ||
      ((writes) => {
        calls.push(writes);
        pending = deferred();
        return pending.promise;
      }),
  });

  const el = (id) => root.querySelector(`#${id}`);
  return {
    root,
    modal,
    calls,
    save: () => el("ps-charge-assign-save"),
    cancel: () => el("ps-charge-assign-cancel"),
    body: () => el("ps-charge-assign-body"),
    feedback: () => el("ps-charge-assign-feedback"),
    pending: () => pending,
    clickSave: () => el("ps-charge-assign-save").dispatch("click"),
    open: (overrides = {}) => modal.open({ planningRows: ONE_ROW, columns: COLS, ...overrides }),
    // Simule une VRAIE frappe sur un champ (le rendu HTML de renderTree() est
    // une simple chaine sur `innerHTML` : aucun element interactif n'en sort,
    // exactement comme les autres tests de ce fichier qui construisent leur
    // propre FakeInput). Depuis fix round 1, handleSave sort tot si rien n'a
    // ete edite (`writes.length === 0` -> closeNow(), pas d'onSubmit) : les
    // scenarios de verrou/double-clic/echec ont donc besoin d'une VRAIE
    // edition en attente pour continuer a exercer handleSave au-dela de cette
    // garde.
    editField: (dataset, value) => {
      const field = new FakeInput("");
      field.classList.add("ps-charge-assign-input");
      field.dataset = dataset;
      field.value = value;
      el("ps-charge-assign-body").dispatch("input", { target: field });
    },
  };
}

// --- double-clic : une seule ecriture ------------------------------------------

test("controleur reel : double-clic sur Enregistrer -> une seule ecriture", async () => {
  const h = mountChargeAssign();
  h.open();
  h.editField({ scope: "type", typeDoc: "COFFRAGE", original: "" }, "5");
  h.clickSave();
  h.clickSave();
  await flush();

  assert.equal(h.calls.length, 1, "un seul appel a onSubmit malgre le double clic");
  assert.equal(h.save().disabled, true, "Enregistrer bloque");

  h.pending().resolve({ ok: true });
  await flush();
  assert.equal(h.modal.isOpen(), false, "le succes ferme la fenetre");
  h.modal.destroy();
});

// --- verrou REELLEMENT partage entre les deux fenetres -------------------------

test("verrou partage : une ecriture de charge en vol empeche la fenetre de segment de s'ouvrir", async () => {
  const charge = mountChargeAssign();
  const segmentRoot = buildEditSegmentRoot();
  const segmentCalls = [];
  let segmentPending = null;
  const segment = createEditSegmentModal(segmentRoot, {
    stallTimeoutMs: STALL_MS,
    onSubmit: (payload) => {
      segmentCalls.push(payload);
      segmentPending = deferred();
      return segmentPending.promise;
    },
  });

  charge.open();
  charge.editField({ scope: "type", typeDoc: "COFFRAGE", original: "" }, "5");
  charge.clickSave();
  await flush();
  assert.equal(charge.calls.length, 1, "l'ecriture de charge est partie");

  segment.open({ segmentId: 41, monthKey: "2026-03", workerName: "Alice", effectif: 3 });
  assert.equal(segment.isOpen(), false, "la fenetre de segment refuse de s'ouvrir : meme verrou tenu");

  charge.pending().resolve({ ok: true });
  await flush();

  segment.open({ segmentId: 41, monthKey: "2026-03", workerName: "Alice", effectif: 3 });
  assert.equal(segment.isOpen(), true, "verrou rendu : la fenetre de segment s'ouvre de nouveau");

  segment.destroy();
  charge.modal.destroy();
});

// --- mirroir local du delai de garde -------------------------------------------

test("apres le delai de garde, Echap ferme la fenetre de charge mais Enregistrer reste bloque", async () => {
  const h = mountChargeAssign();
  h.open();
  h.editField({ scope: "type", typeDoc: "COFFRAGE", original: "" }, "5");
  h.clickSave();
  await flush();
  await afterStall();

  assert.equal(h.feedback().textContent, SUBMIT_STALL_MESSAGE, "l'etat est explique");
  assert.equal(h.save().disabled, true, "Enregistrer RESTE desactive : l'ecriture est en vol");
  assert.equal(h.cancel().disabled, false, "Fermer redevient cliquable");

  document.fire("keydown", { key: "Escape" });
  assert.equal(h.modal.isOpen(), false, "Echap ferme enfin la fenetre");

  // Nettoyage : on regle l'ecriture pour ne rien laisser en vol au test suivant.
  h.pending().resolve({ ok: true });
  await flush();
  h.modal.destroy();
});

// --- echec : la fenetre reste ouverte avec son message -------------------------

test("un echec renvoye laisse la fenetre ouverte avec son message", async () => {
  const h = mountChargeAssign({
    onSubmit: async () => ({ ok: false, error: "L'enregistrement de la charge a echoue." }),
  });
  h.open();
  h.editField({ scope: "type", typeDoc: "COFFRAGE", original: "" }, "5");
  h.clickSave();
  await flush();

  assert.equal(h.modal.isOpen(), true, "la fenetre reste ouverte pour corriger");
  assert.equal(h.feedback().textContent, "L'enregistrement de la charge a echoue.");
  assert.equal(h.save().disabled, false, "et on peut re-essayer");
  h.modal.destroy();
});

// --- vider un champ transmet bien fields:"" a onSubmit -------------------------

test("vider un champ qui avait sa propre valeur transmet Duree_Force:'' a onSubmit", async () => {
  const rows = [{ id: 77, ID2: "3001", Type_doc: "COFFRAGE", Zone: "Zone 1", Duree_Force: 4 }];
  let received = null;
  const h = mountChargeAssign({
    onSubmit: async (writes) => {
      received = writes;
      return { ok: true };
    },
  });
  h.open({ planningRows: rows });

  // Simule le champ Duree_Force du document 77, rendu avec sa propre valeur
  // (donc `original` = "4", pas vide) : le vider est une VRAIE intention
  // d'effacement, contrairement a un champ herite jamais touche.
  const field = new FakeInput("");
  field.classList.add("ps-charge-assign-input");
  field.dataset = { scope: "document", docId: "77", original: "4" };
  field.value = "";
  h.body().dispatch("input", { target: field });

  h.clickSave();
  await flush();

  assert.ok(received, "onSubmit a ete appele");
  assert.deepEqual(received, [{ recordId: 77, fields: { Duree_Force: "" } }]);
  h.modal.destroy();
});

// --- une saisie MAL TAPEE n'est pas un effacement ------------------------------
//
// Les champs sont des <input type="number"> : quand le texte tape n'est pas un
// nombre valide pour le navigateur, l'UA rapporte `.value === ""`. Sans la garde
// `validity.badInput`, ce "" prenait la branche « champ vide explicitement » du
// test precedent — donc une ECRITURE de "" sur ce niveau de la cascade, sans
// marqueur ni message. Et comme "" rend la main au niveau du dessus, un nombre
// restait affiche : rien a l'ecran ne distinguait « j'ai saisi 2,5 » de « j'ai
// efface ma valeur ». Le cas est ordinaire, pas theorique : tout le reste du
// widget accepte la virgule decimale (utils/format.js, documentCharge.js), et
// dans un navigateur en locale francaise la virgule entre dans le champ tout en
// laissant `.value` vide.

test("une saisie que le navigateur ne sait pas convertir est invalide, JAMAIS un effacement", async () => {
  const rows = [
    { id: 77, ID2: "3001", Type_doc: "COFFRAGE", Zone: "Zone 1", Duree_Force: 4 },
    { id: 78, ID2: "3002", Type_doc: "COFFRAGE", Zone: "Zone 1", Duree_Force: 2 },
  ];
  let received = null;
  const h = mountChargeAssign({
    onSubmit: async (writes) => {
      received = writes;
      return { ok: true };
    },
  });
  h.open({ planningRows: rows });

  // Le document 77 : l'utilisateur tape « 2,5 » dans un navigateur en locale
  // francaise -> l'UA garde la virgule a l'ecran mais rend `.value === ""` et
  // leve `validity.badInput`.
  const mistyped = new FakeInput("");
  mistyped.classList.add("ps-charge-assign-input");
  mistyped.dataset = { scope: "document", docId: "77", original: "4" };
  mistyped.value = "";
  mistyped.validity = { badInput: true };
  h.body().dispatch("input", { target: mistyped });

  assert.equal(mistyped.classList.contains("is-invalid"), true, "le champ est marque invalide");

  // Le document 78, lui, recoit une vraie valeur : le lot part quand meme, et
  // c'est ce qui rend l'assertion suivante concluante (un lot vide fermerait la
  // fenetre sans appeler onSubmit, et masquerait le defaut).
  const valid = new FakeInput("");
  valid.classList.add("ps-charge-assign-input");
  valid.dataset = { scope: "document", docId: "78", original: "2" };
  valid.value = "3";
  h.body().dispatch("input", { target: valid });

  h.clickSave();
  await flush();

  assert.ok(received, "onSubmit a ete appele");
  assert.deepEqual(
    received,
    [{ recordId: 78, fields: { Duree_Force: 3 } }],
    "la ligne mal tapee ne doit produire AUCUNE ecriture — surtout pas Duree_Force:''"
  );
  assert.ok(
    !received.some((write) => write.fields.Duree_Force === ""),
    "un effacement silencieux de la cascade serait invisible a l'ecran"
  );
  h.modal.destroy();
});

test("corriger une saisie mal tapee leve le marqueur d'invalidite", async () => {
  // Contrepartie : le marqueur ne doit pas rester colle au champ, sinon
  // handleSave refuserait d'enregistrer a vie.
  const rows = [{ id: 77, ID2: "3001", Type_doc: "COFFRAGE", Zone: "Zone 1", Duree_Force: 4 }];
  const h = mountChargeAssign();
  h.open({ planningRows: rows });

  const field = new FakeInput("");
  field.classList.add("ps-charge-assign-input");
  field.dataset = { scope: "document", docId: "77", original: "4" };
  field.value = "";
  field.validity = { badInput: true };
  h.body().dispatch("input", { target: field });
  assert.equal(field.classList.contains("is-invalid"), true);

  field.validity = { badInput: false };
  field.value = "2.5";
  h.body().dispatch("input", { target: field });
  assert.equal(field.classList.contains("is-invalid"), false, "la saisie corrigee redevient valide");

  h.clickSave();
  await flush();
  assert.deepEqual(h.calls[0], [{ recordId: 77, fields: { Duree_Force: 2.5 } }]);
  h.pending().resolve({ ok: true });
  await flush();
  h.modal.destroy();
});

// --- un champ jamais touche (ou ramene a l'etat affiche) n'ecrit rien ----------

test("un champ tape puis ramene a sa valeur d'origine ferme sans appeler onSubmit", async () => {
  // Distinct du test precedent : ici le champ EST touche (deux evenements
  // 'input'), mais la SECONDE frappe ramene exactement la valeur affichee a
  // l'ouverture ("4"). L'edition en attente doit etre annulee, pas maintenue a
  // "4" (ce qui produirait une ecriture inutile — la ligne a deja cette
  // valeur). Depuis fix round 1, plus aucune edition en attente => handleSave
  // sort tot (closeNow(), pas d'appel a onSubmit) : meme comportement que
  // "un champ jamais touche", mais atteint par un chemin different (edite
  // PUIS annule, plutot que jamais touche).
  const rows = [{ id: 77, ID2: "3001", Type_doc: "COFFRAGE", Zone: "Zone 1", Duree_Force: 4 }];
  let called = false;
  const h = mountChargeAssign({
    onSubmit: async () => {
      called = true;
      return { ok: true };
    },
  });
  h.open({ planningRows: rows });

  const field = new FakeInput("");
  field.classList.add("ps-charge-assign-input");
  field.dataset = { scope: "document", docId: "77", original: "4" };

  field.value = "6";
  h.body().dispatch("input", { target: field }); // edition en attente : Duree_Force -> 6

  field.value = "4"; // retour a la valeur affichee a l'ouverture
  h.body().dispatch("input", { target: field });

  h.clickSave();
  await flush();

  assert.equal(called, false, "le retour a la valeur d'origine annule l'edition en attente : rien a envoyer");
  assert.equal(h.modal.isOpen(), false, "la fenetre se ferme quand meme");
  h.modal.destroy();
});

test("un champ jamais touche ferme la fenetre sans appeler onSubmit", async () => {
  // Fix round 1, minor : handleSave sortait tot AVANT round 1 en appelant
  // quand meme onSubmit([]) — un aller-retour Grist pour rien qui prenait le
  // verrou partage. Desormais rien n'est edite -> fermeture directe, sans
  // meme prendre le verrou.
  let called = false;
  const h = mountChargeAssign({
    onSubmit: async () => {
      called = true;
      return { ok: true };
    },
  });
  h.open(); // ONE_ROW, aucun champ touche

  h.clickSave();
  await flush();

  assert.equal(called, false, "rien n'a ete edite : pas de round-trip Grist inutile");
  assert.equal(h.modal.isOpen(), false, "la fenetre se ferme quand meme");
  h.modal.destroy();
});

// --- FIX ROUND 1, Important 1 : resolution tardive croisee ---------------------
//
// Replay complet du scenario de la brief : un segment cale, se ferme (le
// delai de garde le permet), une fenetre de CHARGE s'ouvre a la place, PUIS
// le segment se resout. Avant fix round 1, chargeAssignModal.js tenait son
// PROPRE registre de controleurs vivants : le `finally` d'editSegmentModal.js
// ne notifiait donc QUE ses propres fenetres, et Enregistrer restait
// desactive A VIE cote charge, avec le message perime toujours affiche.

test("un segment cale, ferme, puis une fenetre de charge ouverte apres coup se debloque a la resolution tardive du segment", async () => {
  const segmentRoot = buildEditSegmentRoot();
  const segEl = (id) => segmentRoot.querySelector(`#${id}`);
  let segmentPending = null;
  const segment = createEditSegmentModal(segmentRoot, {
    stallTimeoutMs: STALL_MS,
    onSubmit: () => {
      segmentPending = deferred();
      return segmentPending.promise;
    },
  });

  segment.open({ segmentId: 41, monthKey: "2026-03", workerName: "Alice", effectif: 3 });
  segEl("ps-edit-segment-effectif").value = "3";
  segEl("ps-edit-segment-save").dispatch("click");
  await flush();
  await afterStall();

  assert.equal(segEl("ps-edit-segment-feedback").textContent, SUBMIT_STALL_MESSAGE, "le segment cale");
  assert.equal(segEl("ps-edit-segment-cancel").disabled, false, "mais redevient fermable");

  segEl("ps-edit-segment-cancel").dispatch("click");
  assert.equal(segment.isOpen(), false, "le segment se ferme ; son ecriture reste en vol");

  const h = mountChargeAssign();
  h.open();
  assert.equal(
    h.feedback().textContent,
    SUBMIT_STALL_MESSAGE,
    "la fenetre de charge affiche a l'ouverture le meme etat de blocage (verrou partage toujours tenu)"
  );
  assert.equal(h.save().disabled, true, "Enregistrer bloque : l'ecriture de segment est toujours en vol");

  // Resolution TARDIVE du segment pendant que SEULE la fenetre de charge est
  // ouverte : exactement le defaut de la brief (fix round 1, Important 1).
  segmentPending.resolve({ ok: true });
  await flush();

  assert.equal(h.save().disabled, false, "Enregistrer se redebloque des la resolution tardive du segment");
  assert.notEqual(h.feedback().textContent, SUBMIT_STALL_MESSAGE, "le message perime disparait");

  segment.destroy();
  h.modal.destroy();
});

// --- FIX ROUND 1, Important 4 : un champ herite ne fige pas la valeur --------
//
// `renderField` doit rendre value="" / data-original="" pour un champ herite
// (la valeur heritee n'apparait qu'en placeholder) : c'est ce court-circuit
// qui fait qu'un champ jamais ouvert n'ecrit rien. Aucun test existant
// n'atteignait le VRAI rendu HTML (les tests de dirty-tracking construisent
// leurs propres FakeInput a la main) : une implementation qui mettrait la
// valeur heritee dans `value`/`data-original` passerait toute la suite tout
// en figeant silencieusement un defaut qui devrait continuer a cascader.

test("un champ herite de zone rend value=\"\" / data-original=\"\", la valeur heritee seulement en placeholder", async () => {
  const rows = [{ id: 90, ID2: "3001", Type_doc: "COFFRAGE", Zone: "Zone 1", Duree_Projet: 5 }];
  const h = mountChargeAssign();
  h.open({ planningRows: rows });

  const html = h.body().innerHTML;
  const zoneField = html.match(/<input[\s\S]*?data-scope="zone"[\s\S]*?>/);
  assert.ok(zoneField, "champ Duree_Zone trouve dans le rendu");

  assert.match(zoneField[0], /data-original=""/, "pas la valeur heritee dans data-original");
  assert.match(zoneField[0], /value=""/, "pas la valeur heritee dans value");
  assert.match(zoneField[0], /placeholder="5 \(herite\)"/, "la valeur heritee est SEULEMENT en placeholder");

  h.modal.destroy();
});

// --- FIX ROUND 1, minor : banniere de divergence ------------------------------

test("la banniere de divergence accorde diverge (singulier) et divergent (pluriel)", async () => {
  const rows = [
    { id: 200, ID2: "5000", Type_doc: "COFFRAGE", Zone: "Zone 1", Duree_Projet: 2 },
    { id: 201, ID2: "5001", Type_doc: "COFFRAGE", Zone: "Zone 1", Duree_Projet: 3 },
    { id: 202, ID2: "5002", Type_doc: "COFFRAGE", Zone: "Zone 1", Duree_Projet: 3 },
  ];
  // Majorite = 3 (2 lignes), donc 1 seule ligne divergente (ID2 "5000").
  const h = mountChargeAssign();
  h.open({ planningRows: rows });

  const html = h.body().innerHTML;
  assert.match(html, /1 ligne diverge sur COFFRAGE \(5000\)/, "singulier, jamais \"1 ligne divergent\"");

  h.modal.destroy();
});

test("la banniere de divergence tronque au-dela de 5 identifiants", async () => {
  const rows = [
    { id: 900, ID2: "9000", Type_doc: "COFFRAGE", Zone: "Zone 1", Duree_Projet: 1 },
    { id: 901, ID2: "9001", Type_doc: "COFFRAGE", Zone: "Zone 1", Duree_Projet: 1 },
    { id: 902, ID2: "9002", Type_doc: "COFFRAGE", Zone: "Zone 1", Duree_Projet: 2 },
    { id: 903, ID2: "9003", Type_doc: "COFFRAGE", Zone: "Zone 1", Duree_Projet: 3 },
    { id: 904, ID2: "9004", Type_doc: "COFFRAGE", Zone: "Zone 1", Duree_Projet: 4 },
    { id: 905, ID2: "9005", Type_doc: "COFFRAGE", Zone: "Zone 1", Duree_Projet: 5 },
    { id: 906, ID2: "9006", Type_doc: "COFFRAGE", Zone: "Zone 1", Duree_Projet: 6 },
    { id: 907, ID2: "9007", Type_doc: "COFFRAGE", Zone: "Zone 1", Duree_Projet: 7 },
  ];
  // Majorite = 1 (2 lignes) ; 6 lignes divergentes, chacune a une valeur
  // distincte -> divergentIds a 6 entrees, doit se tronquer a 5 puis "...".
  const h = mountChargeAssign();
  h.open({ planningRows: rows });

  const html = h.body().innerHTML;
  assert.match(
    html,
    /6 lignes divergent sur COFFRAGE \(9002, 9003, 9004, 9005, 9006, \.\.\.\)/,
    "5 ids montres, puis des points de suspension"
  );

  h.modal.destroy();
});

// --- FIX ROUND 1, minor : confirmation avant de perdre des editions ----------

test("fermer avec des editions en attente demande confirmation ; refuser garde la fenetre ouverte", async () => {
  confirmCalls = [];
  confirmReturnValue = false;
  const rows = [{ id: 77, ID2: "3001", Type_doc: "COFFRAGE", Zone: "Zone 1", Duree_Force: 4 }];
  const h = mountChargeAssign();
  h.open({ planningRows: rows });

  const field = new FakeInput("");
  field.classList.add("ps-charge-assign-input");
  field.dataset = { scope: "document", docId: "77", original: "4" };
  field.value = "6";
  h.body().dispatch("input", { target: field });

  h.cancel().dispatch("click");
  assert.equal(confirmCalls.length, 1, "confirmation demandee : une edition est en attente");
  assert.equal(h.modal.isOpen(), true, "refus de la confirmation : la fenetre reste ouverte");

  // SECONDE demande de fermeture : elle ferme, sans redemander. C'est la
  // soupape contre une fenetre INFERMABLE — un widget Grist vit dans une iframe
  // SANDBOXEE, et sans `allow-modals` la specification HTML impose a
  // `confirm()` de renvoyer `false` IMMEDIATEMENT, sans avoir rien montre a
  // personne : le premier refus serait alors eternel, et fond, Echap et Fermer
  // partagent tous `close()`. Rien ne distingue ce `false`-la d'un vrai clic sur
  // « Annuler », d'ou la regle : le premier est honore, une demande repetee vaut
  // consentement.
  h.cancel().dispatch("click");
  assert.equal(confirmCalls.length, 1, "pas de seconde question : la demande repetee vaut consentement");
  assert.equal(h.modal.isOpen(), false, "la fenetre finit toujours par se fermer");

  h.modal.destroy();
});

test("confirmation acceptee du premier coup : la fenetre se ferme et l'edition est perdue", async () => {
  confirmCalls = [];
  confirmReturnValue = true;
  const rows = [{ id: 77, ID2: "3001", Type_doc: "COFFRAGE", Zone: "Zone 1", Duree_Force: 4 }];
  const h = mountChargeAssign();
  h.open({ planningRows: rows });

  const field = new FakeInput("");
  field.classList.add("ps-charge-assign-input");
  field.dataset = { scope: "document", docId: "77", original: "4" };
  field.value = "6";
  h.body().dispatch("input", { target: field });

  h.cancel().dispatch("click");
  assert.equal(confirmCalls.length, 1, "la question est bien posee");
  assert.equal(h.modal.isOpen(), false);

  h.modal.destroy();
});

test("un hote qui DEFINIT confirm sans rien demander ne bloque pas la fermeture", async () => {
  // Un `confirm` present mais qui ne renvoie pas de booleen (hote qui supprime
  // le dialogue) n'est pas un « non » : le traiter comme tel emprisonnerait
  // l'utilisateur dans la fenetre.
  const previousConfirm = globalThis.confirm;
  confirmCalls = [];
  globalThis.confirm = (message) => {
    confirmCalls.push(message);
    return undefined;
  };
  try {
    const rows = [{ id: 77, ID2: "3001", Type_doc: "COFFRAGE", Zone: "Zone 1", Duree_Force: 4 }];
    const h = mountChargeAssign();
    h.open({ planningRows: rows });

    const field = new FakeInput("");
    field.classList.add("ps-charge-assign-input");
    field.dataset = { scope: "document", docId: "77", original: "4" };
    field.value = "6";
    h.body().dispatch("input", { target: field });

    h.cancel().dispatch("click");
    assert.equal(confirmCalls.length, 1, "la question est bien tentee");
    assert.equal(h.modal.isOpen(), false, "une reponse non booleenne vaut consentement");

    h.modal.destroy();
  } finally {
    globalThis.confirm = previousConfirm;
  }
});

test("une nouvelle ouverture repose la question : la soupape ne se propage pas", async () => {
  // `discardRefusals` est remis a zero a chaque open()/fermeture effective :
  // sinon un refus dans une session rendrait la garde inoperante pour toutes
  // les suivantes.
  confirmCalls = [];
  confirmReturnValue = false;
  const rows = [{ id: 77, ID2: "3001", Type_doc: "COFFRAGE", Zone: "Zone 1", Duree_Force: 4 }];
  const h = mountChargeAssign();

  const edit = () => {
    const field = new FakeInput("");
    field.classList.add("ps-charge-assign-input");
    field.dataset = { scope: "document", docId: "77", original: "4" };
    field.value = "6";
    h.body().dispatch("input", { target: field });
  };

  h.open({ planningRows: rows });
  edit();
  h.cancel().dispatch("click"); // refus honore
  h.cancel().dispatch("click"); // soupape : ferme
  assert.equal(h.modal.isOpen(), false);
  assert.equal(confirmCalls.length, 1);

  h.open({ planningRows: rows });
  edit();
  h.cancel().dispatch("click");
  assert.equal(confirmCalls.length, 2, "la nouvelle session repose bien la question");
  assert.equal(h.modal.isOpen(), true, "et son refus est honore comme le premier");

  confirmReturnValue = true;
  h.modal.destroy();
});

test("fermer une fenetre non modifiee ne demande jamais de confirmation", async () => {
  confirmCalls = [];
  confirmReturnValue = true;
  const h = mountChargeAssign();
  h.open(); // ONE_ROW, aucun champ touche

  h.cancel().dispatch("click");
  assert.equal(confirmCalls.length, 0, "rien n'a ete edite : fermeture en un clic, sans demander");
  assert.equal(h.modal.isOpen(), false);

  h.modal.destroy();
});
