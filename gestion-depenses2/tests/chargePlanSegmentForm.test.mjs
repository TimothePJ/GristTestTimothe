import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CHARGE_PLAN_SAVE_STALL_MESSAGE,
  CHARGE_PLAN_SAVE_STALL_TIMEOUT_MS,
  EFFECTIF_REQUIRED_MESSAGE,
  EFFECTIF_STEP_MESSAGE,
  computeMonthSlotGeometry,
  createChargePlanEditSession,
  createChargePlanSaveLock,
  isHalfDayIncrement,
  resolveChargePlanClickIntent,
  resolveClickedMonthKey,
  validateEffectifInput,
} from "../assets/js/utils/chargePlanSegmentForm.js";
import { HALF_DAY_PARTS, getHalfDaySlotRange } from "../assets/js/utils/timeSegments.js";

// Horloge injectee : `createChargePlanSaveLock` accepte setTimer/clearTimer pour
// que le delai de garde soit testable sans attendre 30 secondes. TOUS les
// verrous construits ici doivent la recevoir — un seul `acquire()` sur l'horloge
// reelle laisserait un setTimeout de 30 s retenir la boucle d'evenements de Node
// et ferait durer la suite autant.
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

// Reproduit la geometrie de buildVisibleSlots : deux creneaux par jour
// calendaire, de largeur fixe, poses bout a bout depuis leftPx = 0.
function buildSlotsForRange(firstDate, lastDate, dayWidth = 10) {
  const slots = [];
  const cursor = new Date(firstDate);
  let leftPx = 0;

  while (cursor <= lastDate) {
    HALF_DAY_PARTS.forEach((part) => {
      const range = getHalfDaySlotRange(cursor, part);
      slots.push({
        startAt: range.startAt,
        endAt: range.endAt,
        leftPx,
        widthPx: dayWidth / 2,
      });
      leftPx += dayWidth / 2;
    });
    cursor.setDate(cursor.getDate() + 1);
  }

  return slots;
}

test("resolveClickedMonthKey rend le mois du creneau clique", () => {
  // Selection produite par computeChargePlanSelectionFromSlotIndexes : ISO.
  const startDate = new Date(2026, 8, 17, 8, 0, 0, 0).toISOString();
  assert.equal(resolveClickedMonthKey({ startDate }), "2026-09");
});

test("resolveClickedMonthKey tient sur les bords du mois, heure locale", () => {
  // Premier creneau du mois : 1er a 8h. Dernier : dernier jour a 17h.
  const firstSlot = new Date(2026, 0, 1, 8, 0, 0, 0).toISOString();
  const lastSlot = new Date(2026, 0, 31, 17, 0, 0, 0).toISOString();
  assert.equal(resolveClickedMonthKey({ startDate: firstSlot }), "2026-01");
  assert.equal(resolveClickedMonthKey({ startDate: lastSlot }), "2026-01");

  // Le creneau suivant bascule bien sur le mois d'apres.
  const nextMonthSlot = new Date(2026, 1, 1, 8, 0, 0, 0).toISOString();
  assert.equal(resolveClickedMonthKey({ startDate: nextMonthSlot }), "2026-02");
});

test("resolveClickedMonthKey accepte aussi une Date", () => {
  assert.equal(
    resolveClickedMonthKey({ startDate: new Date(2027, 11, 25, 13, 0, 0, 0) }),
    "2027-12"
  );
});

test("resolveClickedMonthKey rend une chaine vide sans selection exploitable", () => {
  // Clic hors de toute piste rendue : computeChargePlanSelection... renvoie null.
  assert.equal(resolveClickedMonthKey(null), "");
  assert.equal(resolveClickedMonthKey({}), "");
  assert.equal(resolveClickedMonthKey({ startDate: "" }), "");
  assert.equal(resolveClickedMonthKey({ startDate: "pas une date" }), "");
});

test("validateEffectifInput refuse l'absence de valeur", () => {
  for (const rawValue of [null, undefined, ""]) {
    const result = validateEffectifInput(rawValue);
    assert.equal(result.ok, false);
    assert.equal(result.message, EFFECTIF_REQUIRED_MESSAGE);
  }
});

test("validateEffectifInput refuse zero et les valeurs negatives", () => {
  for (const rawValue of [0, -0.5, -3]) {
    const result = validateEffectifInput(rawValue);
    assert.equal(result.ok, false, `${rawValue} devrait etre refuse`);
    assert.equal(result.message, EFFECTIF_REQUIRED_MESSAGE);
  }
});

test("validateEffectifInput refuse ce qui n'est pas un nombre fini", () => {
  for (const rawValue of [Number.NaN, Number.POSITIVE_INFINITY, "abc"]) {
    const result = validateEffectifInput(rawValue);
    assert.equal(result.ok, false);
    assert.equal(result.message, EFFECTIF_REQUIRED_MESSAGE);
  }
});

test("validateEffectifInput exige un multiple de 0,5", () => {
  const result = validateEffectifInput(3.2);
  assert.equal(result.ok, false);
  assert.equal(result.message, EFFECTIF_STEP_MESSAGE);
});

test("validateEffectifInput accepte les entiers et les demi-journees", () => {
  for (const rawValue of [0.5, 1, 8, 12.5, 21]) {
    const result = validateEffectifInput(rawValue);
    assert.deepEqual(result, { ok: true, effectif: rawValue });
  }
});

test("computeMonthSlotGeometry couvre le mois entier, du 1er au dernier jour", () => {
  // Fenetre rendue : 1er janvier -> 31 mars 2026, 10 px par jour calendaire.
  const slots = buildSlotsForRange(new Date(2026, 0, 1), new Date(2026, 2, 31));

  // Janvier : 31 jours, cale a l'origine.
  assert.deepEqual(computeMonthSlotGeometry(slots, "2026-01"), {
    leftPx: 0,
    widthPx: 310,
  });
  // Fevrier 2026 : 28 jours, demarre apres les 31 jours de janvier.
  assert.deepEqual(computeMonthSlotGeometry(slots, "2026-02"), {
    leftPx: 310,
    widthPx: 280,
  });
  // Mars : 31 jours, jusqu'au bord droit de la fenetre.
  assert.deepEqual(computeMonthSlotGeometry(slots, "2026-03"), {
    leftPx: 590,
    widthPx: 310,
  });
});

test("computeMonthSlotGeometry rend null hors de la fenetre rendue", () => {
  const slots = buildSlotsForRange(new Date(2026, 0, 1), new Date(2026, 2, 31));

  // Avant la fenetre : aucun creneau ne finit dans decembre.
  assert.equal(computeMonthSlotGeometry(slots, "2025-12"), null);
  // Apres la fenetre : aucun creneau ne commence en avril.
  assert.equal(computeMonthSlotGeometry(slots, "2026-04"), null);
  // Mois invalide ou creneaux absents.
  assert.equal(computeMonthSlotGeometry(slots, ""), null);
  assert.equal(computeMonthSlotGeometry([], "2026-01"), null);
  assert.equal(computeMonthSlotGeometry(null, "2026-01"), null);
});

test("computeMonthSlotGeometry se limite a la partie visible d'un mois tronque", () => {
  // La frise virtuelle commence en plein mois : l'emprise ne peut pas deborder.
  const slots = buildSlotsForRange(new Date(2026, 0, 15), new Date(2026, 1, 10));

  assert.deepEqual(computeMonthSlotGeometry(slots, "2026-01"), {
    leftPx: 0,
    widthPx: 170, // 15 -> 31 janvier = 17 jours
  });
  // Fevrier est tronque au 10 : l'emprise s'arrete la, elle ne devient pas null.
  assert.deepEqual(computeMonthSlotGeometry(slots, "2026-02"), {
    leftPx: 170,
    widthPx: 100, // 1er -> 10 fevrier = 10 jours
  });
});

// --- Invariant central : « un segment = un mois », jamais de doublon --------

test("resolveChargePlanClickIntent : un mois vide se cree", () => {
  assert.deepEqual(
    resolveChargePlanClickIntent({ monthKey: "2026-09" }),
    { action: "create", monthKey: "2026-09" }
  );
});

test("resolveChargePlanClickIntent : un mois deja occupe s'edite, il ne se double pas", () => {
  // Clic dans le vide du mois, mais une barre existe deja pour ce mois.
  assert.deepEqual(
    resolveChargePlanClickIntent({ monthKey: "2026-09", monthSegmentId: 412 }),
    { action: "edit", segmentId: 412 }
  );
  // Meme resultat si l'id arrive en chaine depuis le dataset.
  assert.deepEqual(
    resolveChargePlanClickIntent({ monthKey: "2026-09", monthSegmentId: "412" }),
    { action: "edit", segmentId: 412 }
  );
});

test("resolveChargePlanClickIntent : la barre cliquee prime sur la premiere barre du mois", () => {
  // Doublons legacy empiles par assignSegmentLanes : « 8 j » en lane 0 (premier
  // noeud du DOM, donc celui que rend querySelector) et « 3 j » en lane 1.
  // Cliquer sur « 3 j » doit ouvrir 77, pas 42.
  assert.deepEqual(
    resolveChargePlanClickIntent({
      monthKey: "2026-09",
      clickedSegmentId: "77",
      monthSegmentId: "42",
    }),
    { action: "edit", segmentId: 77 }
  );

  // Et cliquer sur celle du dessus ouvre bien celle du dessus.
  assert.deepEqual(
    resolveChargePlanClickIntent({
      monthKey: "2026-09",
      clickedSegmentId: "42",
      monthSegmentId: "42",
    }),
    { action: "edit", segmentId: 42 }
  );
});

test("resolveChargePlanClickIntent : un segment optimiste n'est pas editable", () => {
  // id negatif = pas encore d'id Grist ; l'editer ecrirait sur un id negatif.
  assert.deepEqual(
    resolveChargePlanClickIntent({ monthKey: "2026-09", monthSegmentId: -3 }),
    { action: "pending" }
  );
  assert.deepEqual(
    resolveChargePlanClickIntent({ monthKey: "2026-09", clickedSegmentId: "-3" }),
    { action: "pending" }
  );
  assert.deepEqual(
    resolveChargePlanClickIntent({ monthKey: "2026-09", monthSegmentId: 0 }),
    { action: "pending" }
  );
});

test("resolveChargePlanClickIntent : sans mois resolu, on ne fait rien", () => {
  assert.deepEqual(resolveChargePlanClickIntent({ monthKey: "" }), { action: "ignore" });
  assert.deepEqual(resolveChargePlanClickIntent({}), { action: "ignore" });
  assert.deepEqual(resolveChargePlanClickIntent(), { action: "ignore" });
});

test("resolveChargePlanClickIntent : une barre cliquee sans id lisible ne cree rien", () => {
  // On ne devine pas quelle barre editer, et surtout on ne cree pas un doublon
  // par-dessus une barre existante.
  assert.deepEqual(
    resolveChargePlanClickIntent({
      monthKey: "2026-09",
      clickedSegmentId: "abc",
      monthSegmentId: "42",
    }),
    { action: "ignore" }
  );
});

test("createChargePlanSaveLock : un second Enregistrer pendant l'ecriture ne passe pas", () => {
  const lock = createChargePlanSaveLock({ ...createFakeClock() });

  assert.equal(lock.isSaving(), false);
  assert.equal(lock.acquire(), true, "le premier clic prend le verrou");
  assert.equal(lock.isSaving(), true);
  assert.equal(lock.acquire(), false, "le second clic est refuse");
  assert.equal(lock.acquire(), false, "et le troisieme aussi");

  lock.release();
  assert.equal(lock.isSaving(), false);
  assert.equal(lock.acquire(), true, "le verrou est reutilisable apres release");
});

test("createChargePlanSaveLock : deux clics concurrents ne produisent qu'une ecriture", async () => {
  const lock = createChargePlanSaveLock({ ...createFakeClock() });
  const writes = [];

  // Reproduit saveEditedChargePlanSegment : verrou pris avant le premier await,
  // relache dans le finally.
  async function save(label) {
    if (!lock.acquire()) return "refuse";
    try {
      await new Promise((resolve) => setTimeout(resolve, 5));
      writes.push(label);
      return "ecrit";
    } finally {
      lock.release();
    }
  }

  // Double-clic : les deux appels partent avant que le premier ait rendu.
  const results = await Promise.all([save("clic-1"), save("clic-2")]);

  assert.deepEqual(writes, ["clic-1"], "une seule ligne TimeSegment est creee");
  assert.deepEqual(results, ["ecrit", "refuse"]);
  assert.equal(lock.isSaving(), false, "le verrou est relache a la fin");
});

test("createChargePlanSaveLock : le verrou est relache meme si l'ecriture leve", async () => {
  const lock = createChargePlanSaveLock({ ...createFakeClock() });

  await assert.rejects(async () => {
    if (!lock.acquire()) return;
    try {
      throw new Error("Grist indisponible");
    } finally {
      lock.release();
    }
  });

  assert.equal(lock.isSaving(), false, "sinon la fenetre resterait bloquee a vie");
  assert.equal(lock.acquire(), true);
});

// --- Defaut A : une promesse qui ne se regle jamais ne doit pas condamner la
// fenetre. Le `finally` de saveEditedChargePlanSegment n'arrive alors JAMAIS.

test("createChargePlanSaveLock : la garde de fermeture est armee avec le verrou", () => {
  const clock = createFakeClock();
  const lock = createChargePlanSaveLock({ ...clock });

  assert.equal(lock.blocksClose(), false);
  lock.acquire();
  assert.equal(lock.blocksClose(), true, "la fenetre reste ouverte pendant l'ecriture");
  assert.equal(lock.isStalled(), false);
  assert.equal(clock.pending(), 1, "un delai de garde est arme a l'acquisition");
  assert.deepEqual(clock.delays(), [CHARGE_PLAN_SAVE_STALL_TIMEOUT_MS]);
});

test("createChargePlanSaveLock : a l'expiration, la fermeture se debloque mais PAS l'ecriture", () => {
  const clock = createFakeClock();
  const stalls = [];
  const lock = createChargePlanSaveLock({ ...clock, onStall: () => stalls.push(1) });

  lock.acquire();
  clock.fireAll();

  assert.equal(stalls.length, 1, "onStall notifie une fois");
  assert.equal(lock.isStalled(), true);
  assert.equal(lock.blocksClose(), false, "Annuler / Echap / fond redeviennent possibles");
  assert.equal(lock.isSaving(), true, "le verrou d'ecriture, lui, tient toujours");
  assert.equal(
    lock.acquire(),
    false,
    "une seconde ecriture partirait pendant que la premiere est en vol"
  );
});

test("createChargePlanSaveLock : le finally normal desarme le delai de garde", () => {
  const clock = createFakeClock();
  const stalls = [];
  const lock = createChargePlanSaveLock({ ...clock, onStall: () => stalls.push(1) });

  lock.acquire();
  lock.release();

  assert.equal(clock.pending(), 0, "plus aucun timer en attente");
  assert.equal(clock.fireAll(), 0);
  assert.equal(stalls.length, 0, "onStall n'est jamais appele apres un release");
  assert.equal(lock.isSaving(), false);
  assert.equal(lock.isStalled(), false);
  assert.equal(lock.blocksClose(), false);
});

test("createChargePlanSaveLock : une reprise apres release rearme un delai neuf", () => {
  const clock = createFakeClock();
  const lock = createChargePlanSaveLock({ ...clock });

  lock.acquire();
  clock.fireAll();
  assert.equal(lock.isStalled(), true);

  lock.release();
  assert.equal(lock.acquire(), true, "le verrou se reprend une fois relache");
  assert.equal(lock.isStalled(), false, "l'etat bloque ne colle pas a la prise suivante");
  assert.equal(clock.pending(), 1);
});

test("createChargePlanSaveLock : stallTimeoutMs <= 0 desactive le delai de garde", () => {
  const clock = createFakeClock();
  const lock = createChargePlanSaveLock({ ...clock, stallTimeoutMs: 0 });

  lock.acquire();
  assert.equal(clock.pending(), 0);
  assert.equal(lock.blocksClose(), true);
});

// Garde-fou de la suite elle-meme : le delai par defaut est un vrai setTimeout
// de 30 s. Un test qui l'armerait sans horloge injectee retiendrait la boucle
// d'evenements de Node pendant 30 secondes.
test("createChargePlanSaveLock : le delai par defaut vaut 30 s et n'est jamais arme ici", () => {
  assert.equal(CHARGE_PLAN_SAVE_STALL_TIMEOUT_MS, 30000);
  assert.match(CHARGE_PLAN_SAVE_STALL_MESSAGE, /rechargez le widget/);
});

// --- Defaut B : une resolution tardive ne doit pas piloter une autre session --

test("createChargePlanEditSession : chaque ouverture/fermeture perime les jetons precedents", () => {
  const session = createChargePlanEditSession();

  const beforeOpen = session.current();
  session.renew(); // ouverture sur un mois
  const firstToken = session.current();

  assert.notEqual(firstToken, beforeOpen);
  assert.equal(session.owns(firstToken), true, "l'ecriture en cours est la sienne");

  session.renew(); // fermeture
  assert.equal(session.owns(firstToken), false, "fermer perime le jeton");

  session.renew(); // reouverture sur un autre mois
  assert.equal(session.owns(firstToken), false, "rouvrir aussi");
  assert.equal(session.owns(session.current()), true);
});

test("createChargePlanEditSession : une session sans fermeture garde son jeton", () => {
  const session = createChargePlanEditSession();
  session.renew();
  const token = session.current();

  // Aucune ouverture ni fermeture entre-temps : le chemin nominal doit continuer
  // de fermer la fenetre et d'afficher ses propres messages.
  assert.equal(session.owns(token), true);
});

// Le CABLAGE de la fenetre (main.js : ouverture, verrou, jeton de session,
// fermeture) est epingle par tests/chargePlanModalWiring.test.mjs, qui execute
// le TEXTE REEL de main.js. Il ny a volontairement aucun harnais qui le
// reimplementerait ici : il resterait vert pendant que le vrai cablage casse.

test("isHalfDayIncrement resiste aux flottants issus de la saisie", () => {
  assert.equal(isHalfDayIncrement(0.1 + 0.4), true);
  assert.equal(isHalfDayIncrement(0.1 + 0.2), false);
  assert.equal(isHalfDayIncrement("2.5"), true);
  assert.equal(isHalfDayIncrement("abc"), false);
  // Number("") vaut 0 : c'est validateEffectifInput qui rejette le champ vide,
  // pas ce predicat. Verrouille pour que l'ordre des deux controles reste sur.
  assert.equal(isHalfDayIncrement(""), true);
  assert.equal(validateEffectifInput("").ok, false);
});
