// Tests du CABLAGE REEL de la fenetre « segment mensuel » de main.js.
//
// POURQUOI CE FICHIER EXISTE : `chargePlanSegmentForm.test.mjs` ne couvre que les
// fabriques pures (`createChargePlanSaveLock`, `createChargePlanEditSession`).
// Elles peuvent rester parfaites pendant que le cablage casse — or c'est le
// cablage qui porte les defauts A (fenetre indefermable) et B (resolution tardive
// qui ecrase une autre session).
//
// COMMENT : `main.js` n'est pas importable sous Node (il touche le DOM au
// chargement et tire toute l'application). On extrait donc le TEXTE REEL des cinq
// fonctions concernees et on l'execute dans un `vm` avec des bouchons pour ses
// dependances. Aucune reimplementation : si main.js change, l'extrait change avec
// lui, et si une fonction disparait ou est renommee, l'extraction echoue bruyamment.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const MAIN_PATH = new URL("../assets/js/main.js", import.meta.url);
const FORM_URL = new URL("../assets/js/utils/chargePlanSegmentForm.js", import.meta.url);
const source = fs.readFileSync(MAIN_PATH, "utf8");

const form = await import(FORM_URL.href);
const STALL_MESSAGE = form.CHARGE_PLAN_SAVE_STALL_MESSAGE;
// Delai de garde volontairement court : la suite ne doit pas durer 30 s.
const STALL_MS = 15;

// --- extraction du texte reel ------------------------------------------------

// Corps complet d'une fonction de premier niveau, accolades equilibrees.
function extractFunction(name) {
  const match = new RegExp(`(?:^|\\n)((?:async )?function ${name}\\s*\\()`).exec(source);
  assert.ok(match, `fonction introuvable dans main.js : ${name}`);
  const start = match.index + (match[0].startsWith("\n") ? 1 : 0);

  // Sauter la liste de parametres (elle peut contenir une destructuration).
  let cursor = source.indexOf("(", start);
  let parenDepth = 0;
  for (; cursor < source.length; cursor += 1) {
    if (source[cursor] === "(") parenDepth += 1;
    else if (source[cursor] === ")") {
      parenDepth -= 1;
      if (parenDepth === 0) {
        cursor += 1;
        break;
      }
    }
  }

  let index = source.indexOf("{", cursor);
  let depth = 0;
  for (; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    else if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`accolades non equilibrees pour ${name}`);
}

function extractBlock(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, `bloc introuvable dans main.js : ${startMarker}`);
  const end = source.indexOf(endMarker, start);
  assert.ok(end >= 0, `fin de bloc introuvable : ${endMarker}`);
  return source.slice(start, end + endMarker.length);
}

const LOCK_BLOCK = extractBlock(
  "const chargePlanSaveLock = createChargePlanSaveLock({",
  "});"
);
const SESSION_BLOCK = "const chargePlanEditSession = createChargePlanEditSession();";
const WIRED_FUNCTIONS = [
  "applyChargePlanSaveLockToUi",
  "resetEditChargePlanForm",
  "openCreateChargePlanModal",
  "openEditChargePlanModal",
  "saveEditedChargePlanSegment",
].map(extractFunction);

// --- bouchons ----------------------------------------------------------------

class FakeClassList {
  constructor() {
    this.names = new Set();
  }
  toggle(name, force) {
    if (force) this.names.add(name);
    else this.names.delete(name);
  }
  contains(name) {
    return this.names.has(name);
  }
}
class FakeElement {
  constructor() {
    this.textContent = "";
    this.hidden = false;
    this.classList = new FakeClassList();
  }
}
class FakeInput extends FakeElement {
  constructor() {
    super();
    this.value = "";
  }
}
class FakeButton extends FakeElement {
  constructor() {
    super();
    this.disabled = false;
  }
}

function deferred() {
  let settle = null;
  const promise = new Promise((resolve) => {
    settle = resolve;
  });
  return { promise, resolve: settle };
}

const flush = async () => {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
};
const afterStall = () => new Promise((resolve) => setTimeout(resolve, STALL_MS + 25));

// Monte un contexte neuf : verrou et session de main.js sont des singletons de
// module, chaque scenario doit repartir d'un etat vierge.
function mountMainJs() {
  const ui = {
    open: false,
    monthKey: "",
    worker: "",
    feedback: "",
    provisionalCleared: 0,
    provisionalShown: 0,
  };
  const dom = {
    saveEditSegmentBtn: new FakeButton(),
    cancelEditSegmentBtn: new FakeButton(),
    editSegmentEffectifInput: new FakeInput(),
    editSegmentFeedback: new FakeElement(),
    editSegmentMonthLabel: new FakeElement(),
    editSegmentWorkerLabel: new FakeElement(),
    editSegmentModal: new FakeElement(),
  };
  const writes = [];
  let pending = null;
  let editModeLocked = false;

  const sandbox = {
    console,
    Math,
    Number,
    String,
    Set,
    Promise,
    Boolean,
    Array,
    Object,
    JSON,
    setTimeout,
    clearTimeout,
    HTMLElement: FakeElement,
    HTMLInputElement: FakeInput,
    HTMLButtonElement: FakeButton,
    dom,

    // --- vraies dependances pures, importees du vrai module ------------------
    createChargePlanSaveLock: (options) =>
      form.createChargePlanSaveLock({ ...options, stallTimeoutMs: STALL_MS }),
    createChargePlanEditSession: form.createChargePlanEditSession,
    validateEffectifInput: form.validateEffectifInput,
    CHARGE_PLAN_SAVE_STALL_MESSAGE: STALL_MESSAGE,

    // --- bouchons des dependances de main.js --------------------------------
    getMonthBounds: (key) => (/^\d{4}-\d{2}$/.test(String(key)) ? { startAt: 0, endAt: 1 } : null),
    getMonthBusinessDays: () => 22,
    parseOptionalNumberInput: (value) =>
      value === "" || value == null ? null : Number(String(value).replace(",", ".")),
    // Le vrai `setEditChargePlanFeedback` ecrit dans `dom.editSegmentFeedback` ;
    // `applyChargePlanSaveLockToUi` relit ce meme noeud pour retracter le message
    // d'ecriture bloquee. Le bouchon doit donc tenir les deux a jour.
    setEditChargePlanFeedback: (message = "") => {
      ui.feedback = String(message || "").trim();
      dom.editSegmentFeedback.textContent = ui.feedback;
    },
    setEditChargePlanContextLabels: (monthKey = "", worker = "") => {
      ui.monthKey = monthKey;
      ui.worker = worker;
    },
    syncEditChargePlanDerivedValues: () => {},
    clearProvisionalChargePlanBar: () => {
      ui.provisionalCleared += 1;
    },
    showProvisionalChargePlanBar: () => {
      ui.provisionalShown += 1;
    },
    openModal: () => {
      ui.open = true;
    },
    closeModal: () => {
      ui.open = false;
    },
    isChargePlanSegmentEditModeLocked: () => editModeLocked,
    showChargePlanEditLockedFeedback: () => {},
    getSelectedProject: () => ({
      id: 7,
      projectNumber: "P7",
      workers: [{ id: 1, name: "Alice" }],
    }),
    getSelectedProjectWorker: (workerId) => ({
      id: workerId,
      name: "Alice",
      absenceSet: new Set(),
    }),
    getTimelineSegmentField: () => "segments",
    getTimelineSegmentType: () => "previsionnel",
    formatEditSegmentInputValue: (value) => (value == null ? "" : String(value)),
    findChargePlanSegmentContext: (segmentId) => ({
      projectId: 7,
      boardEl: null,
      worker: { id: 1, name: "Alice", absenceSet: new Set() },
      segment: { id: segmentId, monthKey: "2026-05", effectifDays: 2 },
      segmentField: "segments",
    }),
    createChargePlanSegment: (payload) => {
      writes.push({ kind: "create", ...payload });
      pending = deferred();
      return pending.promise;
    },
    updateChargePlanSegmentSelection: (context, selection) => {
      writes.push({ kind: "update", ...selection });
      pending = deferred();
      return pending.promise;
    },
  };

  const context = vm.createContext(sandbox);
  vm.runInContext(
    [
      "let editingChargePlanSegment = null;",
      LOCK_BLOCK,
      SESSION_BLOCK,
      ...WIRED_FUNCTIONS,
      `globalThis.__api = {
         applyChargePlanSaveLockToUi,
         resetEditChargePlanForm,
         openCreateChargePlanModal,
         openEditChargePlanModal,
         saveEditedChargePlanSegment,
         chargePlanSaveLock,
         chargePlanEditSession,
       };`,
    ].join("\n\n"),
    context,
    { filename: "main.js (extrait)" }
  );

  return {
    api: context.__api,
    dom,
    ui,
    writes,
    pending: () => pending,
    setEditModeLocked: (value) => {
      editModeLocked = value;
    },
    // Simule ce que l'utilisateur a sous les yeux dans la session courante.
    setFeedback: (text) => {
      ui.feedback = text;
      dom.editSegmentFeedback.textContent = text;
    },
    openCreate: (monthKey) =>
      context.__api.openCreateChargePlanModal({
        workerId: 1,
        monthKey,
        boardEl: null,
        trackEl: null,
      }),
  };
}

// --- garde-fou de l'extraction ----------------------------------------------

test("extraction : les cinq fonctions cablees existent toujours dans main.js", () => {
  assert.match(LOCK_BLOCK, /onStall/, "le verrou de main.js doit toujours armer un delai de garde");
  assert.equal(WIRED_FUNCTIONS.length, 5);
  WIRED_FUNCTIONS.forEach((body) => assert.ok(body.length > 40));
});

// --- DEFAUT A ----------------------------------------------------------------

test("cablage reel : pendant l'ecriture, la fenetre refuse de se fermer", async () => {
  const h = mountMainJs();
  h.openCreate("2026-03");
  assert.equal(h.ui.open, true);
  h.dom.editSegmentEffectifInput.value = "4";
  const saving = h.api.saveEditedChargePlanSegment();
  await flush();

  assert.equal(h.writes.length, 1, "une ecriture est partie");
  assert.equal(h.dom.saveEditSegmentBtn.disabled, true, "Enregistrer bloque");
  assert.equal(h.dom.cancelEditSegmentBtn.disabled, true, "Annuler bloque");
  assert.equal(h.dom.editSegmentModal.classList.contains("is-submitting"), true);

  h.api.resetEditChargePlanForm(); // Annuler / Echap / clic sur le fond
  assert.equal(h.ui.open, true, "la fermeture est refusee pendant l'ecriture");

  h.pending().resolve(true);
  await saving;
  await flush();
  assert.equal(h.ui.open, false, "le succes ferme la fenetre");
});

test("defaut A : passe le delai de garde, la fenetre se ferme mais Enregistrer reste bloque", async () => {
  const h = mountMainJs();
  h.openCreate("2026-03");
  h.dom.editSegmentEffectifInput.value = "4";
  const saving = h.api.saveEditedChargePlanSegment();
  await flush();
  await afterStall();

  assert.equal(h.ui.feedback, STALL_MESSAGE, "l'etat est explique");
  assert.equal(h.dom.saveEditSegmentBtn.disabled, true, "Enregistrer RESTE desactive");
  assert.equal(h.dom.cancelEditSegmentBtn.disabled, false, "Annuler redevient cliquable");
  assert.equal(h.dom.editSegmentModal.classList.contains("is-stalled"), true);
  assert.equal(h.dom.editSegmentModal.classList.contains("is-submitting"), false);

  // Un second Enregistrer ne doit lancer AUCUNE ecriture supplementaire.
  await h.api.saveEditedChargePlanSegment();
  assert.equal(h.writes.length, 1, "aucune seconde ecriture apres expiration");
  assert.equal(h.ui.feedback, STALL_MESSAGE, "le message est reaffiche");

  h.api.resetEditChargePlanForm();
  assert.equal(h.ui.open, false, "DEFAUT A : la fenetre se ferme enfin");

  h.pending().resolve(true);
  await saving;
});

// --- DEFAUT B ----------------------------------------------------------------

test("defaut B : un succes tardif ne ferme pas la fenetre rouverte sur un autre segment", async () => {
  const h = mountMainJs();
  h.openCreate("2026-03");
  h.dom.editSegmentEffectifInput.value = "4";
  const saving = h.api.saveEditedChargePlanSegment();
  await flush();
  const firstWrite = h.pending();
  await afterStall();
  h.api.resetEditChargePlanForm();

  h.api.openEditChargePlanModal(88, null); // reouverture sur un AUTRE segment
  assert.equal(h.ui.open, true, "reouverture possible apres expiration");
  assert.equal(h.ui.monthKey, "2026-05", "contexte du nouveau segment");
  assert.equal(h.dom.saveEditSegmentBtn.disabled, true, "Enregistrer toujours bloque");
  h.dom.editSegmentEffectifInput.value = "6";
  h.setFeedback("saisie en cours");
  const clearedBefore = h.ui.provisionalCleared;

  firstWrite.resolve(true); // la PREMIERE ecriture se regle enfin
  await saving;
  await flush();

  assert.equal(h.ui.open, true, "DEFAUT B : la fenetre rouverte n'est pas fermee de force");
  assert.equal(h.ui.monthKey, "2026-05", "contexte intact");
  assert.equal(h.dom.editSegmentEffectifInput.value, "6", "saisie intacte");
  assert.equal(h.ui.feedback, "saisie en cours", "aucun message ecrase");
  assert.equal(h.ui.provisionalCleared, clearedBefore, "la barre provisoire n'est pas effacee");
  assert.equal(h.dom.saveEditSegmentBtn.disabled, false, "le verrou est quand meme relache");
});

test("defaut B : un echec tardif n'affiche pas son message sur la session suivante", async () => {
  const h = mountMainJs();
  h.openCreate("2026-03");
  h.dom.editSegmentEffectifInput.value = "4";
  const saving = h.api.saveEditedChargePlanSegment();
  await flush();
  const firstWrite = h.pending();
  await afterStall();
  h.api.resetEditChargePlanForm();
  h.openCreate("2026-09");
  h.setFeedback("saisie en cours");

  firstWrite.resolve(false); // la premiere ecriture a finalement echoue
  await saving;
  await flush();

  assert.equal(h.ui.feedback, "saisie en cours", "pas de message d'echec perime");
  assert.equal(h.ui.open, true, "fenetre toujours ouverte");
});

test("defaut B : la fenetre restee ouverte est bien fermee par sa propre ecriture", async () => {
  const h = mountMainJs();
  h.openCreate("2026-03");
  h.dom.editSegmentEffectifInput.value = "4";
  const saving = h.api.saveEditedChargePlanSegment();
  await flush();
  await afterStall();
  // L'utilisateur ne touche a rien : la session est toujours la sienne.
  h.pending().resolve(true);
  await saving;
  await flush();
  assert.equal(h.ui.open, false, "l'ecriture a fini par aboutir");
});

test("defaut B : apres une resolution tardive, la session courante peut ecrire", async () => {
  const h = mountMainJs();
  h.openCreate("2026-03");
  h.dom.editSegmentEffectifInput.value = "4";
  const first = h.api.saveEditedChargePlanSegment();
  await flush();
  const firstWrite = h.pending();
  await afterStall();
  h.api.resetEditChargePlanForm();
  h.openCreate("2026-09");
  firstWrite.resolve(true);
  await first;
  await flush();

  h.dom.editSegmentEffectifInput.value = "6";
  const second = h.api.saveEditedChargePlanSegment();
  await flush();
  assert.equal(h.writes.length, 2, "la 2e ecriture part : le verrou est reutilisable");
  assert.equal(h.writes[1].monthKey, "2026-09", "avec le contexte de la session courante");
  h.pending().resolve(true);
  await second;
  await flush();
  assert.equal(h.ui.open, false, "et sa propre resolution ferme la fenetre");
});

test("le message d'ecriture bloquee est retracte quand le verrou est enfin rendu", async () => {
  const h = mountMainJs();
  h.openCreate("2026-03");
  h.dom.editSegmentEffectifInput.value = "4";
  const saving = h.api.saveEditedChargePlanSegment();
  await flush();
  const firstWrite = h.pending();
  await afterStall();
  h.api.resetEditChargePlanForm();
  h.openCreate("2026-09");
  assert.equal(h.ui.feedback, STALL_MESSAGE, "la reouverture rappelle l'ecriture en vol");

  firstWrite.resolve(true);
  await saving;
  await flush();

  assert.equal(h.ui.feedback, "", "le message devenu faux disparait");
  assert.equal(h.dom.saveEditSegmentBtn.disabled, false, "et le formulaire redevient utilisable");
});

test("la retraction n'efface QUE le message d'ecriture bloquee", async () => {
  const h = mountMainJs();
  h.openCreate("2026-03");
  h.dom.editSegmentEffectifInput.value = "4";
  const saving = h.api.saveEditedChargePlanSegment();
  await flush();
  const firstWrite = h.pending();
  await afterStall();
  h.api.resetEditChargePlanForm();
  h.openCreate("2026-09");
  h.setFeedback("saisie en cours");

  firstWrite.resolve(true);
  await saving;
  await flush();

  assert.equal(h.ui.feedback, "saisie en cours", "un message qui n'est pas le sien est intact");
});

// --- Non-regression du geste -------------------------------------------------

test("cablage reel : double-clic sur Enregistrer -> une seule ecriture", async () => {
  const h = mountMainJs();
  h.openCreate("2026-10");
  h.dom.editSegmentEffectifInput.value = "2";
  const first = h.api.saveEditedChargePlanSegment();
  const second = h.api.saveEditedChargePlanSegment();
  await flush();
  assert.equal(h.writes.length, 1, "un seul AddRecord malgre le double-clic");
  h.pending().resolve(true);
  await Promise.all([first, second]);
  await flush();
  assert.equal(h.ui.open, false);
});

test("cablage reel : la validation de l'effectif est inchangee", async () => {
  const h = mountMainJs();
  h.openCreate("2026-11");

  h.dom.editSegmentEffectifInput.value = "3.2";
  await h.api.saveEditedChargePlanSegment();
  assert.equal(h.writes.length, 0, "3,2 refuse");
  assert.match(h.ui.feedback, /entier ou un multiple/);

  h.dom.editSegmentEffectifInput.value = "";
  await h.api.saveEditedChargePlanSegment();
  assert.equal(h.writes.length, 0, "champ vide refuse");
  assert.match(h.ui.feedback, /superieur a 0/);

  h.dom.editSegmentEffectifInput.value = "99";
  const saving = h.api.saveEditedChargePlanSegment();
  await flush();
  assert.equal(h.writes[0].effectif, 22, "plafonne aux jours ouvres du mois");
  h.pending().resolve(true);
  await saving;
});

test("cablage reel : un echec immediat laisse la fenetre ouverte avec son message", async () => {
  const h = mountMainJs();
  h.openCreate("2026-03");
  h.dom.editSegmentEffectifInput.value = "4";
  const saving = h.api.saveEditedChargePlanSegment();
  await flush();
  h.pending().resolve(false);
  await saving;
  await flush();

  assert.equal(h.ui.open, true, "la fenetre reste ouverte pour corriger");
  assert.match(h.ui.feedback, /creation du segment a echoue/);
  assert.equal(h.dom.saveEditSegmentBtn.disabled, false, "et on peut re-essayer");
});

test("cablage reel : le mode consultation refuse toujours l'ecriture", async () => {
  const h = mountMainJs();
  h.openCreate("2026-03");
  h.setEditModeLocked(true);
  h.dom.editSegmentEffectifInput.value = "4";
  await h.api.saveEditedChargePlanSegment();
  assert.equal(h.writes.length, 0);
  assert.match(h.ui.feedback, /Cliquez sur Editer/);
});
