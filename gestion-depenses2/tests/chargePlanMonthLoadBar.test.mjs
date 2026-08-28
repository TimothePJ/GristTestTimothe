// Barre de charge mensuelle de la fenetre « segment mensuel ».
//
// CE QUI EST TESTE : le CABLAGE, pas le calcul. Le noyau pur vit dans
// assets/js/utils/monthLoad.js et a sa propre suite (monthLoad.test.mjs). Ici on
// verifie que main.js le nourrit avec les BONNES entrees — toutes les lignes
// TimeSegment, tous projets et tous services confondus, l'id du segment edite
// exclu — et qu'il rend les trois etats.
//
// COMMENT : meme motif que chargePlanModalWiring.test.mjs. `main.js` n'est pas
// importable sous Node (il touche le DOM au chargement et tire toute
// l'application) : on extrait le TEXTE REEL des fonctions concernees et on
// l'execute dans un `vm`. Les dependances PURES (computeMonthLoad, formatNumber,
// getMonthBounds...) sont les vraies ; seuls le DOM et l'etat sont bouchonnes.
// Aucune reimplementation : si une fonction disparait, l'extraction echoue.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

import { APP_CONFIG } from "../assets/js/config.js";
import { buildExpenseData } from "../assets/js/services/projectService.js";
import { computeMonthLoad } from "../assets/js/utils/monthLoad.js";
import { formatNumber, toFiniteNumber } from "../assets/js/utils/format.js";
import { getSegmentEffectiveDays, parseRawDateTime } from "../assets/js/utils/timeSegments.js";
import {
  getMonthAvailableDays,
  getMonthBounds,
  getMonthBusinessDays,
  toGristMonthValue,
} from "../assets/js/utils/monthSegments.js";

const MAIN_PATH = new URL("../assets/js/main.js", import.meta.url);
const source = fs.readFileSync(MAIN_PATH, "utf8");

// Novembre 2026 : 20 jours ouvres, exactement l'exemple de la specification
// (20 j disponibles, 5 j deja pris ailleurs, 8 j saisis -> 13 j / 20 j).
const MONTH_KEY = "2026-11";
const SEGMENT_COLUMNS = APP_CONFIG.grist.columns.timeSegment;

// --- extraction du texte reel ------------------------------------------------

function extractFunction(name) {
  const match = new RegExp(`(?:^|\\n)((?:async )?function ${name}\\s*\\()`).exec(source);
  assert.ok(match, `fonction introuvable dans main.js : ${name}`);
  const start = match.index + (match[0].startsWith("\n") ? 1 : 0);

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

// Extrait une INSTRUCTION complete (et non une declaration de fonction) a partir
// de son en-tete, qui doit se terminer par « { ». ECHOUE BRUYAMMENT si l'en-tete
// a disparu ou apparait plusieurs fois : une extraction muette produirait « aucun
// test ne tombe », indiscernable d'une vraie garde.
function extractStatement(header) {
  const start = source.indexOf(header);
  assert.ok(start >= 0, `instruction introuvable dans main.js : ${header}`);
  assert.equal(
    source.indexOf(header, start + 1),
    -1,
    `en-tete ambigue dans main.js (plusieurs occurrences) : ${header}`
  );

  const open = start + header.length - 1;
  assert.equal(source[open], "{", `l'en-tete doit se terminer par une accolade : ${header}`);

  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        const tail = source.slice(index + 1, index + 3);
        assert.equal(tail, ");", `fin d'instruction inattendue apres ${header} : « ${tail} »`);
        return source.slice(start, index + 3);
      }
    }
  }
  throw new Error(`accolades non equilibrees dans main.js : ${header}`);
}

// Le VRAI cablage du champ « Jours effectifs travailles » : c'est lui qui doit
// faire suivre la barre a la frappe. Monte tel quel dans mountLoadBar ci-dessous.
const EFFECTIF_FIELD_BINDING = extractStatement(
  "  [dom.editSegmentEffectifInput].forEach((fieldEl) => {"
);

const WIRED_FUNCTION_NAMES = [
  "formatEditSegmentDayValue",
  "setEditChargePlanMetricValue",
  "getAllTimeSegmentRows",
  "formatChargePlanMonthLoadMessage",
  "renderEditChargePlanMonthLoadBar",
  "syncEditChargePlanDerivedValues",
];
const WIRED_FUNCTIONS = WIRED_FUNCTION_NAMES.map(extractFunction);

// --- bouchons DOM -------------------------------------------------------------

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
    this.style = {};
    this.attributes = new Map();
    this.listeners = new Map();
  }
  addEventListener(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(handler);
  }
  // Declenche les VRAIS ecouteurs branches par main.js. Echoue bruyamment si
  // aucun n'est branche : sans cela, « la barre ne bouge pas » et « personne
  // n'ecoute » seraient indiscernables.
  dispatch(type) {
    const handlers = this.listeners.get(type) || [];
    assert.ok(handlers.length > 0, `aucun ecouteur « ${type} » branche sur le champ`);
    handlers.forEach((handler) => handler({ type, target: this }));
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
}
class FakeInput extends FakeElement {
  constructor() {
    super();
    this.value = "";
  }
}

// Monte un contexte neuf autour du texte reel de main.js.
function mountLoadBar({ rows = [], worker = { name: "Alice" }, segment = null } = {}) {
  const dom = {
    editSegmentEffectifInput: new FakeInput(),
    editSegmentCalculatedDays: new FakeElement(),
    editSegmentLoad: new FakeElement(),
    editSegmentLoadTrack: new FakeElement(),
    editSegmentLoadFill: new FakeElement(),
    editSegmentLoadDays: new FakeElement(),
    editSegmentLoadMessage: new FakeElement(),
  };
  const state = { allTimeSegmentRows: rows };
  const feedbacks = [];

  const sandbox = {
    console,
    Math,
    Number,
    String,
    Set,
    Array,
    Object,
    Boolean,
    HTMLElement: FakeElement,
    HTMLInputElement: FakeInput,
    dom,
    state,
    APP_CONFIG,

    // Dependances du cablage du champ Effectif (extrait plus bas), etrangeres a
    // la barre elle-meme.
    chargePlanSaveLock: { isStalled: () => false },
    setEditChargePlanFeedback: (message) => {
      feedbacks.push(message);
    },

    // --- vraies dependances pures --------------------------------------------
    computeMonthLoad,
    formatNumber,
    getMonthAvailableDays,
    getMonthBounds,
    getMonthBusinessDays,
  };

  const context = vm.createContext(sandbox);
  vm.runInContext(
    [
      "let editingChargePlanSegment = null;",
      ...WIRED_FUNCTIONS,
      // Le VRAI cablage du champ, execute : c'est la couture « frappe -> barre ».
      // Une garde textuelle la laissait passer (un `if (false)` autour de l'appel
      // preserve le motif cherche). Ici la barre ne bouge que si le listener
      // appelle reellement syncEditChargePlanDerivedValues.
      EFFECTIF_FIELD_BINDING,
      `globalThis.__api = {
         renderEditChargePlanMonthLoadBar,
         syncEditChargePlanDerivedValues,
         getAllTimeSegmentRows,
         setEditing: (value) => { editingChargePlanSegment = value; },
       };`,
    ].join("\n\n"),
    context,
    { filename: "main.js (extrait)" }
  );

  context.__api.setEditing({
    monthKey: MONTH_KEY,
    worker,
    segment,
    absenceSet: new Set(),
  });

  return {
    api: context.__api,
    dom,
    state,
    // Simule une frappe dans « Jours effectifs travailles », en appelant la
    // fonction derivee comme le fait le listener.
    type: (value) => {
      dom.editSegmentEffectifInput.value = String(value);
      context.__api.syncEditChargePlanDerivedValues();
    },
    // Meme frappe, mais PAR LE VRAI LISTENER branche par main.js : c'est la
    // couture « frappe -> barre » qui est alors exercee, pas seulement le calcul.
    typeViaListener: (value, eventType = "input") => {
      dom.editSegmentEffectifInput.value = String(value);
      dom.editSegmentEffectifInput.dispatch(eventType);
    },
    feedbacks,
    read: () => ({
      hidden: dom.editSegmentLoad.hidden,
      partial: dom.editSegmentLoad.classList.contains("is-partial"),
      balanced: dom.editSegmentLoad.classList.contains("is-balanced"),
      overload: dom.editSegmentLoad.classList.contains("is-overload"),
      width: dom.editSegmentLoadFill.style.width,
      days: dom.editSegmentLoadDays.textContent,
      message: dom.editSegmentLoadMessage.textContent,
    }),
  };
}

function segmentRow({ id, project, name, month = MONTH_KEY, effectif, service = "Structure" }) {
  return {
    [SEGMENT_COLUMNS.id]: id,
    [SEGMENT_COLUMNS.projectNumber]: project,
    [SEGMENT_COLUMNS.name]: name,
    [SEGMENT_COLUMNS.mois]: month,
    [SEGMENT_COLUMNS.effectif]: effectif,
    [SEGMENT_COLUMNS.service]: service,
  };
}

// --- garde-fou de l'extraction ------------------------------------------------

test("extraction : les fonctions de la barre de charge existent dans main.js", () => {
  assert.equal(WIRED_FUNCTIONS.length, WIRED_FUNCTION_NAMES.length);
  WIRED_FUNCTIONS.forEach((body) => assert.ok(body.length > 20));
});

// --- 1. les lignes de TOUS les projets sont exposees --------------------------

test("buildExpenseData expose les lignes TimeSegment de TOUS les projets et services", () => {
  const rows = [
    segmentRow({ id: 1, project: "100", name: "Alice", effectif: 8, service: "Structure" }),
    segmentRow({ id: 2, project: "999", name: "Alice", effectif: 5, service: "Methodes" }),
  ];

  const data = buildExpenseData({
    projectRows: [{ id: 1, Numero_de_projet: "100", Nom_de_projet: "Projet A" }],
    budgetRows: [],
    listePlanRows: [],
    planningProjectRows: [],
    projectTeamRows: [{ id: 51, NumeroProjet: "100", Name: "Alice" }],
    timesheetRows: [],
    timeSegmentRows: rows,
    timeRealRows: [],
    teamRows: [],
    timeOutRows: [],
  });

  assert.ok(Array.isArray(data.allTimeSegmentRows), "allTimeSegmentRows est expose");
  assert.equal(data.allTimeSegmentRows.length, 2, "aucune ligne perdue");
  // Le projet 999 n'existe meme pas dans projectRows : c'est precisement le cas
  // que la barre doit voir, et que la ventilation par projet fait disparaitre.
  assert.ok(
    data.allTimeSegmentRows.some((row) => row[SEGMENT_COLUMNS.projectNumber] === "999"),
    "la ligne d'un autre projet survit"
  );
  // Non-regression : la ventilation par projet, elle, reste filtree.
  const [project] = data.projects;
  assert.equal(project.workers[0].segments.length, 1, "le projet n'affiche que ses propres segments");
});

test("buildExpenseData tolere l'absence de lignes TimeSegment", () => {
  const data = buildExpenseData({
    projectRows: [],
    budgetRows: [],
    listePlanRows: [],
    planningProjectRows: [],
    projectTeamRows: [],
    timesheetRows: [],
    timeSegmentRows: undefined,
    timeRealRows: [],
    teamRows: [],
    timeOutRows: [],
  });

  assert.deepEqual(data.allTimeSegmentRows, []);
});

// Monte le VRAI `performLoadData` de main.js sur des tables bouchonnees. C'est la
// couture « chargement -> cache » : les deux assertions textuelles qui la
// gardaient etaient VACUES — remplacer `allTimeSegmentRows` par
// `allTimeSegmentRows: []` dans le setState preserve les deux motifs cherches et
// livre pourtant un cache VIDE. Seule l'execution mord.
function mountLoadData(tables) {
  const state = { selectedProjectId: null, allTimeSegmentRows: null };
  const calls = { renderApp: 0, fetchProjectDataTables: 0 };

  const sandbox = {
    console,
    state,
    APP_CONFIG,
    window: {},
    localStorage: { getItem: () => null },

    // --- vraie dependance : c'est elle qui produit allTimeSegmentRows ---------
    buildExpenseData,

    // --- bouchons ------------------------------------------------------------
    setState: (patch) => Object.assign(state, patch),
    fetchProjectsForDropdown: async () => tables.projectRows,
    fetchProjectDataTables: async () => {
      calls.fetchProjectDataTables += 1;
      const { projectRows: _ignored, ...rest } = tables;
      return rest;
    },
    findProjectBySharedSelection: () => null,
    readSharedProjectSelection: () => null,
    saveSharedProjectSelection: () => {},
    syncStateToProjectStart: () => {},
    setChargePlanRangeStartDate: () => {},
    captureAppScroll: () => () => {},
    renderApp: () => {
      calls.renderApp += 1;
    },
  };

  const context = vm.createContext(sandbox);
  vm.runInContext(
    [
      "let expenseDataLoadGeneration = 0;",
      "let expenseDataReady = false;",
      "let cachedProjectRows = null;",
      "let planningManagementHover = null;",
      "let lastRenderedProjectId = null;",
      extractFunction("performLoadData"),
      "globalThis.__api = { performLoadData };",
    ].join("\n\n"),
    context,
    { filename: "main.js (extrait performLoadData)" }
  );

  return { api: context.__api, state, calls };
}

test("le chargement initial livre a la barre un cache PEUPLE (tables -> etat -> barre)", async () => {
  // La chaine complete, executee : fetchProjectDataTables -> buildExpenseData ->
  // setState -> la VRAIE barre. Un cache livre vide ferait annoncer 8 j au lieu
  // de 13 j — la charge des autres projets disparaitrait en silence.
  const h = mountLoadData({
    projectRows: [{ id: 1, Numero_de_projet: "100", Nom_de_projet: "Projet A" }],
    budgetRows: [],
    listePlanRows: [],
    planningProjectRows: [],
    projectTeamRows: [{ id: 51, NumeroProjet: "100", Name: "Alice" }],
    timesheetRows: [],
    timeSegmentRows: [segmentRow({ id: 2, project: "999", name: "Alice", effectif: 5, service: "Methodes" })],
    timeRealRows: [],
    teamRows: [],
    timeOutRows: [],
  });

  assert.equal(await h.api.performLoadData({}), true, "le chargement doit aboutir");
  assert.equal(h.calls.renderApp, 1, "et redessiner une fois");
  assert.equal(
    h.state.allTimeSegmentRows.length,
    1,
    "la ligne du projet 999 doit survivre dans le cache brut"
  );

  const bar = mountLoadBar({ rows: h.state.allTimeSegmentRows, segment: null });
  bar.type("8");
  assert.equal(bar.read().days, "13 j / 20 j", "cache vide : la barre annoncerait 8 j / 20 j");
  assert.equal(bar.read().message, "il reste 7 j avant 100 %");
});

test("le chargement initial n'invente pas de lignes quand il n'y en a aucune", async () => {
  const h = mountLoadData({
    projectRows: [{ id: 1, Numero_de_projet: "100", Nom_de_projet: "Projet A" }],
    budgetRows: [],
    listePlanRows: [],
    planningProjectRows: [],
    projectTeamRows: [{ id: 51, NumeroProjet: "100", Name: "Alice" }],
    timesheetRows: [],
    timeSegmentRows: [],
    timeRealRows: [],
    teamRows: [],
    timeOutRows: [],
  });

  await h.api.performLoadData({});
  // `Array.from` ramene le tableau dans le realm du test : un tableau ne du vm
  // echouerait sur deepEqual pour une raison de prototype, sans rapport avec la
  // regle testee.
  assert.deepEqual(Array.from(h.state.allTimeSegmentRows), []);

  const bar = mountLoadBar({ rows: h.state.allTimeSegmentRows, segment: null });
  bar.type("8");
  assert.equal(bar.read().days, "8 j / 20 j");
});

test("main.js alimente state.allTimeSegmentRows depuis buildExpenseData", () => {
  // Garde SECONDAIRE, qui ne fait que nommer le raccord : la regle est EXERCEE
  // par les deux tests ci-dessus. Seule, elle etait vacue.
  assert.match(
    source,
    /const \{[^}]*allTimeSegmentRows[^}]*\} = buildExpenseData\(tables\);/,
    "performLoadData destructure allTimeSegmentRows"
  );
  assert.match(
    source,
    /setState\(\{[^}]*allTimeSegmentRows[^}]*\}\)/,
    "et le pose dans l'etat"
  );
});

// --- 2. les trois etats rendus ------------------------------------------------

test("etat PARTIELLE : 5 j ailleurs + 8 j saisis = 13 j / 20 j, il reste 7 j", () => {
  const h = mountLoadBar({
    rows: [segmentRow({ id: 2, project: "999", name: "Alice", effectif: 5 })],
  });

  h.type("8");
  const view = h.read();

  assert.equal(view.hidden, false, "la barre est visible");
  assert.equal(view.partial, true, "etat partiel");
  assert.equal(view.balanced, false);
  assert.equal(view.overload, false);
  assert.equal(view.days, "13 j / 20 j");
  assert.equal(view.message, "il reste 7 j avant 100 %");
  assert.equal(view.width, "65%", "13/20 = 65 %");
});

test("etat PLEINE : la charge atteint pile le disponible", () => {
  const h = mountLoadBar({
    rows: [segmentRow({ id: 2, project: "999", name: "Alice", effectif: 5 })],
  });

  h.type("15");
  const view = h.read();

  assert.equal(view.balanced, true, "etat plein");
  assert.equal(view.partial, false);
  assert.equal(view.overload, false);
  assert.equal(view.days, "20 j / 20 j");
  assert.equal(view.message, "charge complete");
  assert.equal(view.width, "100%");
});

test("etat SURCHARGE : au-dela du disponible, la barre sature et dit de combien", () => {
  const h = mountLoadBar({
    rows: [segmentRow({ id: 2, project: "999", name: "Alice", effectif: 5 })],
  });

  h.type("20");
  const view = h.read();

  assert.equal(view.overload, true, "etat surcharge");
  assert.equal(view.partial, false);
  assert.equal(view.balanced, false);
  assert.equal(view.days, "25 j / 20 j");
  assert.equal(view.message, "SURCHARGE : 5 j de trop");
  assert.equal(view.width, "100%", "le remplissage est plafonne a 100 %");
});

// --- 3. mise a jour en direct pendant la frappe -------------------------------

test("la barre se recalcule a chaque frappe, sans rechargement", () => {
  const h = mountLoadBar({
    rows: [segmentRow({ id: 2, project: "999", name: "Alice", effectif: 5 })],
  });

  h.type("1");
  assert.equal(h.read().days, "6 j / 20 j");
  h.type("18");
  assert.equal(h.read().days, "23 j / 20 j");
  assert.equal(h.read().overload, true, "l'etat suit la frappe");
  h.type("");
  assert.equal(h.read().days, "5 j / 20 j", "champ vide : il ne reste que l'autre projet");
  assert.equal(h.read().partial, true);
});

test("la barre suit la frappe PAR LE VRAI LISTENER du champ Effectif", () => {
  // La couture « frappe -> barre », executee. La garde textuelle qui vivait ici
  // etait vacue : entourer l'appel d'un `if (globalThis.__never)` preserve le
  // motif cherche et fige pourtant la barre. Ici, elle ne bouge que si le vrai
  // handler « input » appelle reellement syncEditChargePlanDerivedValues.
  const h = mountLoadBar({
    rows: [segmentRow({ id: 2, project: "999", name: "Alice", effectif: 5 })],
  });

  h.typeViaListener("8");
  assert.equal(h.read().days, "13 j / 20 j", "la barre doit suivre la frappe, sans rechargement");
  assert.equal(h.read().message, "il reste 7 j avant 100 %");
  assert.equal(h.read().partial, true);

  h.typeViaListener("20");
  assert.equal(h.read().days, "25 j / 20 j", "et suivre CHAQUE frappe");
  assert.equal(h.read().overload, true);
});

test("l'evenement change du champ Effectif fait suivre la barre lui aussi", () => {
  // Coller une valeur ou quitter le champ n'emet pas toujours « input » : le
  // second ecouteur branche par main.js doit mener au meme resultat.
  const h = mountLoadBar({
    rows: [segmentRow({ id: 2, project: "999", name: "Alice", effectif: 5 })],
  });

  h.typeViaListener("15", "change");
  assert.equal(h.read().days, "20 j / 20 j");
  assert.equal(h.read().balanced, true);
});

test("la saisie efface le message d'erreur, sauf ecriture bloquee", () => {
  // Non-regression du MEME handler : sans cet effacement, un message d'echec
  // resterait affiche pendant que l'utilisateur corrige sa saisie.
  const h = mountLoadBar({
    rows: [segmentRow({ id: 2, project: "999", name: "Alice", effectif: 5 })],
  });

  h.typeViaListener("8");
  assert.deepEqual(h.feedbacks, [""], "le handler vide le message avant de recalculer");
});

test("le listener de saisie de main.js passe bien par syncEditChargePlanDerivedValues", () => {
  // Garde SECONDAIRE, qui ne fait que nommer le raccord : la regle est EXERCEE
  // par les trois tests ci-dessus. Seule, elle etait vacue.
  assert.match(
    source,
    /const handleEditSegmentFieldChange = \(\) => \{[\s\S]*?syncEditChargePlanDerivedValues\(\);[\s\S]*?\};/,
    "le handler de saisie recalcule les valeurs derivees"
  );
  assert.match(
    source,
    /fieldEl\.addEventListener\("input", handleEditSegmentFieldChange\)/,
    "et il est branche sur l'evenement input"
  );
});

// --- 4. exclusion du segment en cours d'edition -------------------------------

test("edition : l'effectif deja stocke n'est PAS compte en plus de la saisie", () => {
  const h = mountLoadBar({
    rows: [
      segmentRow({ id: 42, project: "100", name: "Alice", effectif: 6 }),
      segmentRow({ id: 99, project: "999", name: "Alice", effectif: 5 }),
    ],
    segment: { id: 42, monthKey: MONTH_KEY, effectifDays: 6 },
  });

  h.type("8");
  // 5 (autre projet) + 8 (saisie) = 13, et surtout PAS 19.
  assert.equal(h.read().days, "13 j / 20 j");
  assert.equal(h.read().message, "il reste 7 j avant 100 %");
});

test("creation : rien a exclure, toutes les lignes existantes comptent", () => {
  const h = mountLoadBar({
    rows: [
      segmentRow({ id: 42, project: "100", name: "Alice", effectif: 6 }),
      segmentRow({ id: 99, project: "999", name: "Alice", effectif: 5 }),
    ],
    segment: null,
  });

  h.type("8");
  assert.equal(h.read().days, "19 j / 20 j", "6 + 5 + 8");
  assert.equal(h.read().message, "il reste 1 j avant 100 %");
});

test("la charge d'une AUTRE personne n'entre pas dans la barre", () => {
  const h = mountLoadBar({
    rows: [
      segmentRow({ id: 1, project: "999", name: "Bob", effectif: 12 }),
      segmentRow({ id: 2, project: "999", name: "Alice", effectif: 5 }),
    ],
  });

  h.type("8");
  assert.equal(h.read().days, "13 j / 20 j");
});

test("la charge d'un AUTRE mois n'entre pas dans la barre", () => {
  const h = mountLoadBar({
    rows: [
      segmentRow({ id: 1, project: "999", name: "Alice", month: "2026-10", effectif: 12 }),
      segmentRow({ id: 2, project: "999", name: "Alice", effectif: 5 }),
    ],
  });

  h.type("8");
  assert.equal(h.read().days, "13 j / 20 j");
});

// --- 5. etats degrades --------------------------------------------------------

test("sans mois valide (fenetre fermee), la barre est masquee et videe", () => {
  const h = mountLoadBar({
    rows: [segmentRow({ id: 2, project: "999", name: "Alice", effectif: 5 })],
  });
  h.type("8");
  assert.equal(h.read().hidden, false);

  h.api.setEditing(null);
  h.api.syncEditChargePlanDerivedValues();
  const view = h.read();

  assert.equal(view.hidden, true, "plus rien a montrer");
  assert.equal(view.partial, false);
  assert.equal(view.balanced, false);
  assert.equal(view.overload, false);
  assert.equal(view.width, "0%");
});

test("les absences reduisent le disponible affiche par la barre", () => {
  const h = mountLoadBar({ rows: [] });
  // 2026-11-02 (lundi) et 2026-11-03 (mardi) poses entierement : 20 -> 18 j.
  h.api.setEditing({
    monthKey: MONTH_KEY,
    worker: { name: "Alice" },
    segment: null,
    absenceSet: new Set([
      "2026-11-02:am",
      "2026-11-02:pm",
      "2026-11-03:am",
      "2026-11-03:pm",
    ]),
  });

  h.type("18");
  assert.equal(h.read().days, "18 j / 18 j");
  assert.equal(h.read().balanced, true);
});

// --- 6. le cache que la barre lit suit les mutations OPTIMISTES ----------------
//
// `state.allTimeSegmentRows` est un cache BRUT de la table TimeSegment, alimente
// par `performLoadData` seul. Les mutations optimistes du plan de charge ne
// touchaient, elles, que `state.projects[].workers[].segments` : la barre lisait
// donc un cache perime jusqu'au prochain rechargement.
//
// Creation et modification s'en tiraient PAR CHANCE : la ligne ecrite etait
// absente du cache ET exclue par `excludeSegmentId`, les deux erreurs
// s'annulaient. La SUPPRESSION, non — c'est le scenario d'echec ci-dessous.
//
// On execute ici les VRAIS helpers de main.js (extraits, comme plus haut) puis on
// branche le cache obtenu sur la VRAIE barre : la chaine complete, pas la
// presence d'une chaine de caracteres.

const MUTATION_FUNCTION_NAMES = [
  "isRealChargePlanSegmentType",
  "getChargePlanSegmentStateKeys",
  "mergeChargePlanMonthlyDays",
  "buildChargePlanDaysByMonthFromSegments",
  "sortChargePlanSegments",
  "normalizeOptionalEffectifDays",
  "cloneChargePlanSegment",
  "buildOptimisticChargePlanSegment",
  "rebuildWorkerChargePlanState",
  "updateProjectWorkerLocally",
  "getAllTimeSegmentRows",
  "isSameTimeSegmentRowId",
  "buildTimeSegmentRowFromSegment",
  "addTimeSegmentRowLocally",
  "removeTimeSegmentRowLocally",
  "replaceTimeSegmentRowIdLocally",
  "replaceChargePlanSegmentLocally",
  "replaceChargePlanSegmentIdLocally",
  "addChargePlanSegmentLocally",
  "removeChargePlanSegmentLocally",
];

function planSegment({ id, monthKey = MONTH_KEY, effectifDays, segmentType = "previsionnel" }) {
  const bounds = getMonthBounds(monthKey);
  return {
    id: Number(id),
    projectTeamLink: 10,
    monthKey,
    startAt: bounds.startAt,
    endAt: bounds.endAt,
    segmentType,
    allocationDays: getMonthBusinessDays(monthKey),
    effectifDays,
    label: "",
    isPendingSync: Number(id) <= 0,
  };
}

// Monte les VRAIS helpers de mutation optimiste sur un etat neuf.
function mountOptimistic({ rows = [], segments = [] } = {}) {
  const state = {
    selectedProjectId: 1,
    projects: [
      {
        id: 1,
        projectNumber: "100",
        workers: [
          {
            id: 10,
            name: "Alice",
            segments,
            realSegments: [],
            provisionalDays: {},
            workedDays: {},
          },
        ],
      },
    ],
    allTimeSegmentRows: rows,
  };

  const sandbox = {
    console,
    APP_CONFIG,
    state,
    setState: (patch) => Object.assign(state, patch),
    getSelectedProject: () => state.projects.find((project) => project.id === state.selectedProjectId) || null,
    renderChargePlanSection: () => {},
    scheduleDeferredProjectViewsRender: () => {},

    // --- vraies dependances pures --------------------------------------------
    toFiniteNumber,
    getMonthBounds,
    getMonthBusinessDays,
    toGristMonthValue,
    parseRawDateTime,
    getSegmentEffectiveDays,
  };

  const context = vm.createContext(sandbox);
  vm.runInContext(
    [
      ...MUTATION_FUNCTION_NAMES.map(extractFunction),
      `globalThis.__api = {
         ${MUTATION_FUNCTION_NAMES.join(",\n         ")}
       };`,
    ].join("\n\n"),
    context,
    { filename: "main.js (extrait mutations)" }
  );

  return { api: context.__api, state };
}

test("extraction : les helpers de mutation optimiste existent dans main.js", () => {
  const h = mountOptimistic();
  MUTATION_FUNCTION_NAMES.forEach((name) => {
    assert.equal(typeof h.api[name], "function", `helper manquant : ${name}`);
  });
});

test("SUPPRESSION puis re-saisie : la barre ne compte plus la ligne supprimee", () => {
  // Le scenario d'echec exact : Alice a 6 j en novembre, l'utilisateur supprime
  // puis reclique aussitot sur novembre pour saisir 8 j. La fenetre s'ouvre en
  // CREATION (excludeSegmentId null) : si le cache garde la ligne supprimee, la
  // barre annonce 14 j / 20 j au lieu de 8.
  const h = mountOptimistic({
    rows: [segmentRow({ id: 42, project: "100", name: "Alice", effectif: 6 })],
    segments: [planSegment({ id: 42, effectifDays: 6 })],
  });

  const removed = h.api.removeChargePlanSegmentLocally({
    projectId: 1,
    workerId: 10,
    segmentType: "previsionnel",
    segmentId: 42,
  });
  assert.equal(removed, true, "la suppression optimiste doit aboutir");
  assert.deepEqual(Array.from(h.state.allTimeSegmentRows), [], "la ligne quitte AUSSI le cache brut");

  const bar = mountLoadBar({ rows: h.state.allTimeSegmentRows, segment: null });
  bar.type("8");
  assert.equal(bar.read().days, "8 j / 20 j", "et surtout PAS 14 j / 20 j");
  assert.equal(bar.read().message, "il reste 12 j avant 100 %");
});

test("suppression qui echoue : la ligne restituee recompte dans la barre", () => {
  const h = mountOptimistic({
    rows: [segmentRow({ id: 42, project: "100", name: "Alice", effectif: 6 })],
    segments: [planSegment({ id: 42, effectifDays: 6 })],
  });

  const previousSegment = planSegment({ id: 42, effectifDays: 6 });
  h.api.removeChargePlanSegmentLocally({ projectId: 1, workerId: 10, segmentType: "previsionnel", segmentId: 42 });
  h.api.addChargePlanSegmentLocally({ projectId: 1, workerId: 10, segment: previousSegment });

  assert.equal(h.state.allTimeSegmentRows.length, 1, "marche arriere : le cache retrouve sa ligne");

  const bar = mountLoadBar({ rows: h.state.allTimeSegmentRows, segment: null });
  bar.type("8");
  assert.equal(bar.read().days, "14 j / 20 j", "l'ecriture a echoue : les 6 j sont toujours pris");
});

test("la ligne posee dans le cache est fidele a ce que Grist renverra", () => {
  const h = mountOptimistic();
  const created = h.api.buildOptimisticChargePlanSegment({
    segmentId: -1,
    workerId: 10,
    monthKey: MONTH_KEY,
    effectif: 8,
  });
  h.api.addChargePlanSegmentLocally({ projectId: 1, workerId: 10, segment: created });

  assert.equal(h.state.allTimeSegmentRows.length, 1);
  const [row] = h.state.allTimeSegmentRows;
  assert.equal(row[SEGMENT_COLUMNS.name], "Alice", "sans le nom, computeMonthLoad ignore la ligne");
  assert.equal(row[SEGMENT_COLUMNS.projectNumber], "100");
  assert.equal(row[SEGMENT_COLUMNS.mois], toGristMonthValue(MONTH_KEY), "sans le mois, la ligne est ecartee");
  assert.equal(row[SEGMENT_COLUMNS.effectif], 8);
  assert.equal(row[SEGMENT_COLUMNS.allocationDays], 20, "novembre 2026 = 20 jours ouvres");
  assert.equal(Number(row.id), -1, "l'id optimiste, remplace des que Grist rend le sien");
});

test("l'id Grist remplace l'id optimiste : re-editer le segment cree ne double pas", () => {
  const h = mountOptimistic();
  const created = h.api.buildOptimisticChargePlanSegment({
    segmentId: -1,
    workerId: 10,
    monthKey: MONTH_KEY,
    effectif: 8,
  });
  h.api.addChargePlanSegmentLocally({ projectId: 1, workerId: 10, segment: created });
  h.api.replaceChargePlanSegmentIdLocally({
    projectId: 1,
    workerId: 10,
    segmentType: "previsionnel",
    currentSegmentId: -1,
    persistedSegmentId: 500,
  });

  assert.deepEqual(
    Array.from(h.state.allTimeSegmentRows, (row) => Number(row.id)),
    [500],
    "le cache porte desormais l'id Grist"
  );

  // La fenetre se rouvre sur CE segment : excludeSegmentId = 500. Avec un cache
  // reste sur -1, l'exclusion ne mordrait pas et la barre afficherait 18 j.
  const bar = mountLoadBar({
    rows: h.state.allTimeSegmentRows,
    segment: { id: 500, monthKey: MONTH_KEY, effectifDays: 8 },
  });
  bar.type("10");
  assert.equal(bar.read().days, "10 j / 20 j");
});

test("creation qui echoue : la ligne optimiste disparait du cache", () => {
  const h = mountOptimistic();
  const created = h.api.buildOptimisticChargePlanSegment({
    segmentId: -1,
    workerId: 10,
    monthKey: MONTH_KEY,
    effectif: 8,
  });
  h.api.addChargePlanSegmentLocally({ projectId: 1, workerId: 10, segment: created });
  h.api.removeChargePlanSegmentLocally({
    projectId: 1,
    workerId: 10,
    segmentType: "previsionnel",
    segmentId: -1,
  });

  assert.deepEqual(Array.from(h.state.allTimeSegmentRows), []);
});

test("une modification met a jour le cache : un AUTRE segment du mois le voit", () => {
  // Deux projets, la meme personne, le meme mois. L'utilisateur porte le segment
  // du projet 100 de 6 a 10 j, puis ouvre celui du projet 999 : la barre doit
  // compter 10 j deja pris, pas 6.
  const h = mountOptimistic({
    rows: [
      segmentRow({ id: 42, project: "100", name: "Alice", effectif: 6 }),
      segmentRow({ id: 99, project: "999", name: "Alice", effectif: 5 }),
    ],
    segments: [planSegment({ id: 42, effectifDays: 6 })],
  });

  h.api.replaceChargePlanSegmentLocally({
    projectId: 1,
    workerId: 10,
    segment: h.api.cloneChargePlanSegment(planSegment({ id: 42, effectifDays: 6 }), {
      monthKey: MONTH_KEY,
      effectifDays: 10,
    }),
  });

  const bar = mountLoadBar({
    rows: h.state.allTimeSegmentRows,
    segment: { id: 99, monthKey: MONTH_KEY, effectifDays: 5 },
  });
  bar.type("5");
  assert.equal(bar.read().days, "15 j / 20 j", "10 (modifie) + 5 (saisie)");
});

test("un deplacement de mois suit dans le cache", () => {
  const h = mountOptimistic({
    rows: [segmentRow({ id: 42, project: "100", name: "Alice", effectif: 6 })],
    segments: [planSegment({ id: 42, effectifDays: 6 })],
  });

  h.api.replaceChargePlanSegmentLocally({
    projectId: 1,
    workerId: 10,
    segment: h.api.cloneChargePlanSegment(planSegment({ id: 42, effectifDays: 6 }), {
      monthKey: "2026-12",
      effectifDays: 6,
    }),
  });

  const bar = mountLoadBar({ rows: h.state.allTimeSegmentRows, segment: null });
  bar.type("8");
  assert.equal(bar.read().days, "8 j / 20 j", "les 6 j sont partis en decembre");
});

test("les segments de TEMPS REEL n'entrent jamais dans le cache TimeSegment", () => {
  // `realSegments` vient d'une AUTRE table : l'y ajouter gonflerait la barre
  // d'une charge deja comptee ailleurs.
  const h = mountOptimistic();
  h.api.addChargePlanSegmentLocally({
    projectId: 1,
    workerId: 10,
    segment: planSegment({ id: 900, effectifDays: 4, segmentType: "reel" }),
  });

  assert.deepEqual(Array.from(h.state.allTimeSegmentRows), []);
});

test("une mutation qui n'a rien change laisse le cache intact", () => {
  const rows = [segmentRow({ id: 42, project: "100", name: "Alice", effectif: 6 })];
  const h = mountOptimistic({ rows, segments: [planSegment({ id: 42, effectifDays: 6 })] });

  // Personne inconnue : updateProjectWorkerLocally rend false, rien ne doit
  // bouger cote cache non plus.
  const removed = h.api.removeChargePlanSegmentLocally({
    projectId: 1,
    workerId: 999,
    segmentType: "previsionnel",
    segmentId: 42,
  });

  assert.equal(removed, false);
  assert.deepEqual(Array.from(h.state.allTimeSegmentRows), rows);
});

// --- BOUT EN BOUT : Grist -> fetchProjectDataTables -> l etat -> la barre -----
//
// LE test du bug « Charge du mois — tous projets ne prend pas tous les projets en
// compte ». Tous les tests ci-dessus fournissent les lignes a la main : ils ne
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
    segmentRow({ id: 1, project: "100", name: "Alice", effectif: 6, service: "Structure" }),
    segmentRow({ id: 2, project: "999", name: "Alice", effectif: 5, service: "Methodes" }),
  ];

  const previousWindow = globalThis.window;
  globalThis.window = {
    grist: {
      docApi: {
        __serviceContextPatched: true,
        async fetchTable(tableName, options) {
          if (tableName !== APP_CONFIG.grist.tables.timeSegment) return { id: [] };
          if (options && options.fullTable === true) return rows.map((row) => ({ ...row }));
          // Le filtre projet + service de la couche de contexte partagee.
          return rows
            .filter((row) => (
              row[SEGMENT_COLUMNS.projectNumber] === "100" &&
              row[SEGMENT_COLUMNS.service] === "Structure"
            ))
            .map((row) => ({ ...row }));
        },
      },
    },
  };

  let dataTables;
  try {
    const serviceUrl = new URL("../assets/js/services/gristService.js", import.meta.url);
    serviceUrl.searchParams.set("test", "month-load-bar-end-to-end");
    const service = await import(serviceUrl.href);
    dataTables = await service.fetchProjectDataTables();
  } finally {
    globalThis.window = previousWindow;
  }

  assert.deepEqual(
    dataTables.timeSegmentRows.map((row) => row[SEGMENT_COLUMNS.id]),
    [1],
    "la vue projet reste filtree projet + service (non-regression)"
  );

  // La chaine de main.js, executee sur ces tables REELLEMENT lues.
  const h = mountLoadData({
    projectRows: [{ id: 1, Numero_de_projet: "100", Nom_de_projet: "Projet A" }],
    ...dataTables,
    projectTeamRows: [{ id: 51, NumeroProjet: "100", Name: "Alice" }],
  });

  assert.equal(await h.api.performLoadData({}), true, "le chargement doit aboutir");
  assert.ok(
    Array.from(h.state.allTimeSegmentRows).some((row) => row[SEGMENT_COLUMNS.projectNumber] === "999"),
    "la ligne du projet 999 (service Methodes) doit atteindre le cache"
  );

  // Segment 1 en cours d edition : ses 6 j stockes sont exclus, restent 5 j
  // ailleurs + 8 j saisis = 13 j sur 20. Sans la lecture complete : 8 j / 20 j.
  const bar = mountLoadBar({
    rows: h.state.allTimeSegmentRows,
    segment: { id: 1 },
  });
  bar.type("8");
  assert.equal(bar.read().days, "13 j / 20 j");
  assert.equal(bar.read().message, "il reste 7 j avant 100 %");
});
