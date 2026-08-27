import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateEditSegmentEffectif,
  formatEditSegmentInputValue,
  formatSegmentMonthLabel,
  createSubmitLock,
  createSubmitSession,
  SUBMIT_STALL_TIMEOUT_MS,
} from "../assets/js/bottom/editSegmentModal.js";

// Horloge injectee : `createSubmitLock` accepte setTimer/clearTimer pour que le
// delai de garde soit testable sans attendre 30 secondes.
function createFakeClock() {
  const timers = new Map();
  let nextId = 1;
  return {
    setTimer(fn, delay) {
      const id = nextId++;
      timers.set(id, { fn, delay });
      return id;
    },
    clearTimer(id) {
      timers.delete(id);
    },
    pending: () => timers.size,
    // Declenche tous les timers armes, comme le ferait l'expiration du delai.
    fireAll() {
      const queued = [...timers.entries()];
      timers.clear();
      queued.forEach(([, timer]) => timer.fn());
      return queued.length;
    },
    delays: () => [...timers.values()].map((timer) => timer.delay),
  };
}

test("validateEditSegmentEffectif exige une valeur strictement positive", () => {
  assert.ok(validateEditSegmentEffectif("").error);
  assert.ok(validateEditSegmentEffectif("0").error);
  assert.ok(validateEditSegmentEffectif("-1").error);
  assert.ok(validateEditSegmentEffectif("2,3").error);
  assert.deepEqual(validateEditSegmentEffectif("3.5"), {
    effectifDays: 3.5,
    effectifValueForSave: 3.5,
  });
});

test("validateEditSegmentEffectif: null/undefined/non numerique sont refuses", () => {
  assert.ok(validateEditSegmentEffectif(null).error);
  assert.ok(validateEditSegmentEffectif(undefined).error);
  assert.ok(validateEditSegmentEffectif("abc").error);
  // Message distinct selon la cause : obligatoire vs pas de demi-journee.
  assert.match(validateEditSegmentEffectif("").error, /superieur a 0/);
  assert.match(validateEditSegmentEffectif("1.25").error, /entier ou un multiple/);
});

test("validateEditSegmentEffectif accepte la virgule decimale francaise", () => {
  assert.deepEqual(validateEditSegmentEffectif("1,5"), {
    effectifDays: 1.5,
    effectifValueForSave: 1.5,
  });
});

test("formatSegmentMonthLabel: cle mois -> libelle capitalise, sinon vide", () => {
  assert.equal(formatSegmentMonthLabel("2026-03"), "Mars 2026");
  assert.equal(formatSegmentMonthLabel("2026-12"), "Decembre 2026");
  assert.equal(formatSegmentMonthLabel("2026-13"), "");
  assert.equal(formatSegmentMonthLabel("2026-3"), "");
  assert.equal(formatSegmentMonthLabel(""), "");
  assert.equal(formatSegmentMonthLabel(null), "");
});

test("formatEditSegmentInputValue: trims trailing zeros, blanks null/negative", () => {
  assert.equal(formatEditSegmentInputValue(2), "2");
  assert.equal(formatEditSegmentInputValue(1.5), "1.5");
  assert.equal(formatEditSegmentInputValue(null), "");
  assert.equal(formatEditSegmentInputValue(""), "");
  assert.equal(formatEditSegmentInputValue(-3), "");
});

// Le double-clic sur Enregistrer est ce qui creerait deux lignes pour le meme
// (projet, personne, mois) : le verrou doit refuser la seconde prise tant que la
// premiere n'est pas relachee.
test("createSubmitLock: une seule prise a la fois", () => {
  const lock = createSubmitLock({ ...createFakeClock() });

  assert.equal(lock.isLocked(), false);
  assert.equal(lock.acquire(), true);
  assert.equal(lock.isLocked(), true);
  assert.equal(lock.acquire(), false, "un second Enregistrer doit etre refuse");

  lock.release();
  assert.equal(lock.isLocked(), false);
  assert.equal(lock.acquire(), true);
  lock.release();
});

test("createSubmitLock: deux verrous sont independants", () => {
  const first = createSubmitLock({ ...createFakeClock() });
  const second = createSubmitLock({ ...createFakeClock() });

  first.acquire();
  assert.equal(second.isLocked(), false);
  assert.equal(second.acquire(), true);
  first.release();
  second.release();
});

test("createSubmitLock: la garde de fermeture est armee avec le verrou", () => {
  const clock = createFakeClock();
  const lock = createSubmitLock({ ...clock });

  assert.equal(lock.blocksClose(), false);
  lock.acquire();
  assert.equal(lock.blocksClose(), true, "la fenetre reste ouverte pendant l'ecriture");
  assert.equal(lock.isStalled(), false);
  assert.equal(clock.pending(), 1, "un delai de garde est arme a l'acquisition");
  assert.deepEqual(clock.delays(), [SUBMIT_STALL_TIMEOUT_MS]);
});

// Le cas qui rendait la fenetre indefermable : la promesse Grist ne se regle
// jamais, donc le `finally` de l'appelant n'arrive jamais.
test("createSubmitLock: a l'expiration, la fermeture se debloque mais PAS l'ecriture", () => {
  const clock = createFakeClock();
  const stalls = [];
  const lock = createSubmitLock({ ...clock, onStall: () => stalls.push(Date.now()) });

  lock.acquire();
  clock.fireAll();

  assert.equal(stalls.length, 1, "onStall notifie une fois");
  assert.equal(lock.isStalled(), true);
  assert.equal(lock.blocksClose(), false, "Echap / Fermer / fond redeviennent possibles");
  assert.equal(lock.isLocked(), true, "le verrou d'ecriture, lui, tient toujours");
  assert.equal(
    lock.acquire(),
    false,
    "une seconde ecriture partirait pendant que la premiere est en vol"
  );
});

test("createSubmitLock: le finally normal desarme le delai de garde", () => {
  const clock = createFakeClock();
  const stalls = [];
  const lock = createSubmitLock({ ...clock, onStall: () => stalls.push(1) });

  lock.acquire();
  lock.release();

  assert.equal(clock.pending(), 0, "plus aucun timer en attente");
  assert.equal(clock.fireAll(), 0);
  assert.equal(stalls.length, 0, "onStall n'est jamais appele apres un release");
  assert.equal(lock.isLocked(), false);
  assert.equal(lock.isStalled(), false);
  assert.equal(lock.blocksClose(), false);
});

test("createSubmitLock: une reprise apres release rearme un delai neuf", () => {
  const clock = createFakeClock();
  const lock = createSubmitLock({ ...clock });

  lock.acquire();
  clock.fireAll();
  assert.equal(lock.isStalled(), true);

  lock.release();
  assert.equal(lock.acquire(), true, "le verrou se reprend une fois relache");
  assert.equal(lock.isStalled(), false, "l'etat bloque ne colle pas a la prise suivante");
  assert.equal(clock.pending(), 1);
});

test("createSubmitLock: stallTimeoutMs <= 0 desactive le delai de garde", () => {
  const clock = createFakeClock();
  const lock = createSubmitLock({ ...clock, stallTimeoutMs: 0 });

  lock.acquire();
  assert.equal(clock.pending(), 0);
  assert.equal(lock.blocksClose(), true);
});

// Garde-fou de la suite elle-meme : le delai par defaut est un vrai setTimeout
// de 30 s. Un test qui l'armerait sans horloge injectee retiendrait la boucle
// d'evenements de Node pendant 30 secondes.
test("createSubmitLock: le delai par defaut vaut 30 s et n'est jamais arme ici", () => {
  assert.equal(SUBMIT_STALL_TIMEOUT_MS, 30000);
});

// --- Session de saisie : une resolution tardive ne pilote pas une autre fenetre

test("createSubmitSession: chaque ouverture/fermeture perime les jetons precedents", () => {
  const session = createSubmitSession();

  const beforeOpen = session.current();
  session.renew(); // open() sur un segment
  const firstToken = session.current();

  assert.notEqual(firstToken, beforeOpen);
  assert.equal(session.owns(firstToken), true, "l'ecriture en cours est la sienne");

  session.renew(); // closeNow()
  assert.equal(session.owns(firstToken), false, "fermer perime le jeton");

  session.renew(); // open() sur un autre segment
  assert.equal(session.owns(firstToken), false, "rouvrir aussi");
  assert.equal(session.owns(session.current()), true);
});

test("createSubmitSession: sans ouverture ni fermeture, le jeton reste valable", () => {
  const session = createSubmitSession();
  session.renew();
  const token = session.current();

  // Chemin nominal : la fenetre ne bouge pas pendant l'aller-retour Grist, donc
  // la sauvegarde doit continuer de la fermer et d'afficher ses messages.
  assert.equal(session.owns(token), true);
});

// Le CONTROLEUR reel (createEditSegmentModal : ouverture, verrou partage, jeton
// de session, fermeture) est epingle par tests/editSegmentModalDom.test.mjs, qui
// le pilote avec un vrai DOM minimal. Il ny a volontairement aucun harnais qui
// le reimplementerait ici : il resterait vert pendant que le vrai cablage casse.
