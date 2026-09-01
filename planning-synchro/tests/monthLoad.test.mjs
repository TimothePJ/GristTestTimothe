import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildMonthOverloadIndex,
  computeMonthLoad,
  formatLoadProjectEntries,
  parseEffectifDays,
} from "../assets/js/utils/monthLoad.js";

// Colonnes telles que les deux widgets les declarent dans config.js.
const COLS = { mois: "Mois", startDate: "Start_At", name: "Name", effectif: "Effectif" };

// Septembre 2026 : 30 jours, 8 de week-end, aucun ferie => 22 jours ouvres.
const MONTH = "2026-09";
const AVAILABLE = 22;

function segment(id, name, effectif, extra = {}) {
  return { id, Mois: "2026-09-01", Name: name, Effectif: effectif, ...extra };
}

// Toutes les demi-journees ouvrees de septembre 2026 : la personne est en conge
// tout le mois, sa disponibilite tombe a 0.
function fullMonthAbsence() {
  const set = new Set();
  for (let day = 1; day <= 30; day += 1) {
    const key = `2026-09-${String(day).padStart(2, "0")}`;
    set.add(`${key}:am`);
    set.add(`${key}:pm`);
  }
  return set;
}

function load(overrides = {}) {
  return computeMonthLoad({
    monthKey: MONTH,
    personName: "Marie Dupont",
    allSegmentRows: [],
    columns: COLS,
    absenceSet: null,
    excludeSegmentId: null,
    draftEffectif: null,
    ...overrides,
  });
}

test("la charge additionne TOUS les projets et TOUS les services de la personne", () => {
  const rows = [
    segment(1, "Marie Dupont", 5, { NumeroProjet: "P-001", Service: "Structure" }),
    segment(2, "Marie Dupont", 3, { NumeroProjet: "P-002", Service: "Fluides" }),
  ];
  const result = load({ allSegmentRows: rows, draftEffectif: 5 });

  assert.equal(result.availableDays, AVAILABLE);
  assert.equal(result.otherDays, 8);
  assert.equal(result.draftDays, 5);
  assert.equal(result.totalDays, 13);
  assert.equal(result.state, "partial");
  assert.equal(result.remainingDays, 9);
  assert.equal(result.overloadDays, 0);
  assert.ok(Math.abs(result.ratio - 13 / 22) < 1e-9, `ratio attendu 13/22, obtenu ${result.ratio}`);
});

test("state vaut balanced a la frontiere EXACTE des 100 %", () => {
  const rows = [segment(1, "Marie Dupont", 8, { NumeroProjet: "P-001" })];
  const result = load({ allSegmentRows: rows, draftEffectif: 14 });

  assert.equal(result.totalDays, 22);
  assert.equal(result.state, "balanced");
  assert.equal(result.remainingDays, 0);
  assert.equal(result.overloadDays, 0);
  assert.equal(result.ratio, 1);
});

test("un demi-jour au-dessus des 100 % bascule en overload", () => {
  const rows = [segment(1, "Marie Dupont", 8)];
  const result = load({ allSegmentRows: rows, draftEffectif: 14.5 });

  assert.equal(result.totalDays, 22.5);
  assert.equal(result.state, "overload");
  assert.equal(result.overloadDays, 0.5);
  assert.equal(result.remainingDays, 0);
  assert.ok(result.ratio > 1);
});

test("un demi-jour sous les 100 % reste partial", () => {
  const rows = [segment(1, "Marie Dupont", 8)];
  const result = load({ allSegmentRows: rows, draftEffectif: 13.5 });

  assert.equal(result.totalDays, 21.5);
  assert.equal(result.state, "partial");
  assert.equal(result.remainingDays, 0.5);
  assert.equal(result.overloadDays, 0);
});

test("la frontiere resiste a la derive des flottants", () => {
  // 0.1 + 16.1 + 5.8 ne vaut PAS 22 en binaire : sans tolerance, ce cas
  // basculerait a tort en overload.
  assert.notEqual(0.1 + 16.1 + 5.8, 22);
  const rows = [segment(1, "Marie Dupont", 0.1), segment(2, "Marie Dupont", 16.1)];
  const result = load({ allSegmentRows: rows, draftEffectif: 5.8 });

  assert.equal(result.state, "balanced");
  assert.equal(result.remainingDays, 0);
  assert.equal(result.overloadDays, 0);
});

test("les absences reduisent le denominateur, pas la charge saisie", () => {
  // Trois demi-journees d'absence => 22 - 1.5 = 20.5 jours disponibles.
  const absences = new Set(["2026-09-01:am", "2026-09-01:pm", "2026-09-02:am"]);
  const rows = [segment(1, "Marie Dupont", 20)];
  const result = load({ allSegmentRows: rows, absenceSet: absences, draftEffectif: 0.5 });

  assert.equal(result.availableDays, 20.5);
  assert.equal(result.totalDays, 20.5);
  assert.equal(result.state, "balanced");
});

test("le segment en cours d'edition n'est jamais compte deux fois", () => {
  const rows = [segment(42, "Marie Dupont", 6), segment(7, "Marie Dupont", 4)];
  const result = load({ allSegmentRows: rows, excludeSegmentId: 42, draftEffectif: 9 });

  assert.equal(result.otherDays, 4);
  assert.equal(result.totalDays, 13);
});

test("excludeSegmentId compare nombre et chaine indifferemment", () => {
  const rows = [segment(42, "Marie Dupont", 6), segment("7", "Marie Dupont", 4)];

  // id numerique dans la ligne, chaine dans la fenetre
  assert.equal(load({ allSegmentRows: rows, excludeSegmentId: "42" }).otherDays, 4);
  // id chaine dans la ligne, nombre dans la fenetre
  assert.equal(load({ allSegmentRows: rows, excludeSegmentId: 7 }).otherDays, 6);
  // creation : aucun segment exclu
  assert.equal(load({ allSegmentRows: rows, excludeSegmentId: null }).otherDays, 10);
});

test("un mois sans aucune disponibilite rend toute charge surchargee, sans Infinity ni NaN", () => {
  const result = load({ absenceSet: fullMonthAbsence(), draftEffectif: 1 });

  assert.equal(result.availableDays, 0);
  assert.equal(result.totalDays, 1);
  assert.equal(result.state, "overload");
  assert.equal(result.overloadDays, 1);
  assert.equal(result.remainingDays, 0);
  // Choix documente : la barre est pleine (ratio sature a 1), jamais Infinity.
  assert.equal(result.ratio, 1);
  assert.ok(Number.isFinite(result.ratio));
});

test("un mois sans disponibilite et sans charge reste a l'equilibre, ratio 0", () => {
  const result = load({ absenceSet: fullMonthAbsence(), draftEffectif: "" });

  assert.equal(result.availableDays, 0);
  assert.equal(result.totalDays, 0);
  assert.equal(result.state, "balanced");
  assert.equal(result.ratio, 0);
  assert.ok(Number.isFinite(result.ratio));
});

test("les prenoms composes ne sont pas confondus avec leur variante espacee", () => {
  const rows = [
    segment(1, "Jean-Pierre Martin", 5),
    segment(2, "Jean Pierre Martin", 4),
  ];

  assert.equal(load({ allSegmentRows: rows, personName: "Jean-Pierre Martin" }).otherDays, 5);
  assert.equal(load({ allSegmentRows: rows, personName: "Jean Pierre Martin" }).otherDays, 4);
});

test("l'appariement des noms ignore accents, casse et espaces surnumeraires", () => {
  const rows = [segment(1, "  ELOÏSE   Le Goff ", 3)];
  assert.equal(load({ allSegmentRows: rows, personName: "eloise le goff" }).otherDays, 3);
});

test("une autre personne ou un autre mois ne pese jamais sur le total", () => {
  const rows = [
    segment(1, "Marie Dupont", 5),
    segment(2, "Karim Benali", 8),
    { id: 3, Mois: "2026-10-01", Name: "Marie Dupont", Effectif: 7 },
  ];
  assert.equal(load({ allSegmentRows: rows }).otherDays, 5);
});

test("un Effectif en chaine a virgule francaise est lu comme un nombre", () => {
  const rows = [segment(1, "Marie Dupont", "7,5"), segment(2, "Marie Dupont", " 2,5 ")];
  const result = load({ allSegmentRows: rows, draftEffectif: "3,5" });

  assert.equal(result.otherDays, 10);
  assert.equal(result.draftDays, 3.5);
  assert.equal(result.totalDays, 13.5);
});

test("une ligne dont le mois ne se resout pas est ignoree", () => {
  const rows = [
    segment(1, "Marie Dupont", 5),
    { id: 2, Mois: "", Start_At: "", Name: "Marie Dupont", Effectif: 9 },
    { id: 3, Mois: "bidon", Name: "Marie Dupont", Effectif: 9 },
    { id: 4, Name: "Marie Dupont", Effectif: 9 },
  ];
  assert.equal(load({ allSegmentRows: rows }).otherDays, 5);
});

test("une ligne legacy sans Mois retombe sur Start_At", () => {
  const rows = [
    { id: 1, Start_At: "2026-09-17", Name: "Marie Dupont", Effectif: 4 },
    { id: 2, Mois: "", Start_At: "2026-10-05", Name: "Marie Dupont", Effectif: 9 },
  ];
  assert.equal(load({ allSegmentRows: rows }).otherDays, 4);
});

test("une saisie vide, nulle, nulle-valeur ou illisible vaut 0 jour", () => {
  for (const draft of [null, undefined, "", "   ", 0, "0", "abc", NaN, Infinity, -3]) {
    const result = load({ draftEffectif: draft });
    assert.equal(result.draftDays, 0, `draftEffectif=${String(draft)}`);
    assert.equal(result.totalDays, 0);
    assert.equal(result.state, "partial");
  }
});

test("le module survit a des entrees absentes ou aberrantes", () => {
  const empty = computeMonthLoad();
  assert.equal(empty.availableDays, 0);
  assert.equal(empty.totalDays, 0);
  assert.ok(Number.isFinite(empty.ratio));

  assert.equal(load({ allSegmentRows: null }).otherDays, 0);
  assert.equal(load({ allSegmentRows: [null, undefined] }).otherDays, 0);
  assert.equal(load({ monthKey: "bidon", draftEffectif: 3 }).availableDays, 0);
  assert.equal(load({ personName: "   " }).otherDays, 0);
});

test("l'id de ligne peut venir d'une colonne declaree", () => {
  const rows = [
    { rowId: 42, Mois: "2026-09-01", Name: "Marie Dupont", Effectif: 6 },
    { rowId: 7, Mois: "2026-09-01", Name: "Marie Dupont", Effectif: 4 },
  ];
  const columns = { ...COLS, id: "rowId" };
  assert.equal(load({ allSegmentRows: rows, columns, excludeSegmentId: 42 }).otherDays, 4);
});

test("parseEffectifDays normalise les formes rencontrees dans Grist", () => {
  assert.equal(parseEffectifDays(7.5), 7.5);
  assert.equal(parseEffectifDays("7,5"), 7.5);
  assert.equal(parseEffectifDays("7.5"), 7.5);
  assert.equal(parseEffectifDays(null), 0);
  assert.equal(parseEffectifDays(""), 0);
  assert.equal(parseEffectifDays("bidon"), 0);
  assert.equal(parseEffectifDays(Infinity), 0);
});

// --- Detail par projet -------------------------------------------------------
//
// La barre dit COMBIEN de jours sont deja pris ; `byProject` dit OU. C'est la
// meme boucle qui produit les deux, donc les deux ne peuvent pas se contredire —
// l'invariant somme(byProject) === otherDays est verifie plus bas.

const COLS_WITH_PROJECT = { ...COLS, projectNumber: "NumeroProjet" };

test("byProject ventile les jours par projet, du plus charge au moins charge", () => {
  const rows = [
    segment(1, "Marie Dupont", 4, { NumeroProjet: "241102" }),
    segment(2, "Marie Dupont", 9, { NumeroProjet: "252035" }),
    segment(3, "Marie Dupont", 1, { NumeroProjet: "999999" }),
  ];
  const result = load({ allSegmentRows: rows, columns: COLS_WITH_PROJECT });

  assert.deepEqual(result.byProject, [
    { projectNumber: "252035", days: 9 },
    { projectNumber: "241102", days: 4 },
    { projectNumber: "999999", days: 1 },
  ]);
});

test("plusieurs lignes sur un meme projet sont cumulees en une seule entree", () => {
  // Une personne peut porter deux lignes sur le meme projet le meme mois (deux
  // services, par exemple) : la liste doit montrer UN projet, pas deux.
  const rows = [
    segment(1, "Marie Dupont", 3, { NumeroProjet: "252035", Service: "Structure" }),
    segment(2, "Marie Dupont", 2, { NumeroProjet: "252035", Service: "Fluides" }),
  ];
  const result = load({ allSegmentRows: rows, columns: COLS_WITH_PROJECT });

  assert.deepEqual(result.byProject, [{ projectNumber: "252035", days: 5 }]);
});

test("a jours egaux, l'ordre suit le numero de projet et ne depend pas des lignes", () => {
  // Sans ce second critere, l'ordre d'affichage suivrait celui, arbitraire, des
  // lignes renvoyees par Grist : la liste bougerait d'un rafraichissement a
  // l'autre sans qu'aucune donnee n'ait change.
  const rows = [
    segment(1, "Marie Dupont", 2, { NumeroProjet: "300000" }),
    segment(2, "Marie Dupont", 2, { NumeroProjet: "100000" }),
    segment(3, "Marie Dupont", 2, { NumeroProjet: "200000" }),
  ];
  const result = load({ allSegmentRows: rows, columns: COLS_WITH_PROJECT });

  assert.deepEqual(
    result.byProject.map((entry) => entry.projectNumber),
    ["100000", "200000", "300000"]
  );
});

test("le segment en cours d'edition est exclu de byProject comme de otherDays", () => {
  // La liste repond a « ou sont ses jours EN DEHORS de ce que je saisis ».
  // Le projet courant ne doit donc pas s'y retrouver via la ligne ouverte.
  const rows = [
    segment(1, "Marie Dupont", 6, { NumeroProjet: "252035" }),
    segment(2, "Marie Dupont", 4, { NumeroProjet: "241102" }),
  ];
  const result = load({
    allSegmentRows: rows,
    columns: COLS_WITH_PROJECT,
    excludeSegmentId: 1,
    draftEffectif: 8,
  });

  assert.deepEqual(result.byProject, [{ projectNumber: "241102", days: 4 }]);
  assert.equal(result.otherDays, 4);
  assert.equal(result.totalDays, 12);
});

test("la somme de byProject vaut EXACTEMENT otherDays", () => {
  // L'invariant qui rend la liste lisible : le detail doit rendre compte de la
  // totalite du chiffre affiche par la barre, sinon l'utilisateur cherche des
  // jours manquants qui n'existent pas.
  const rows = [
    segment(1, "Marie Dupont", 0.5, { NumeroProjet: "A" }),
    segment(2, "Marie Dupont", "2,5", { NumeroProjet: "B" }),
    segment(3, "Marie Dupont", 7, { NumeroProjet: "A" }),
    segment(4, "Marie Dupont", 1.5, { NumeroProjet: "C" }),
  ];
  const result = load({ allSegmentRows: rows, columns: COLS_WITH_PROJECT });

  const sum = result.byProject.reduce((total, entry) => total + entry.days, 0);
  assert.equal(sum, result.otherDays);
  assert.equal(result.otherDays, 11.5);
});

test("une ligne sans numero de projet lisible est regroupee, jamais perdue", () => {
  // Ses jours comptent dans le total : les omettre de la liste ferait mentir
  // l'invariant ci-dessus et donnerait un detail qui ne tombe pas juste.
  const rows = [
    segment(1, "Marie Dupont", 5, { NumeroProjet: "252035" }),
    segment(2, "Marie Dupont", 2, { NumeroProjet: "   " }),
    segment(3, "Marie Dupont", 1),
  ];
  const result = load({ allSegmentRows: rows, columns: COLS_WITH_PROJECT });

  assert.deepEqual(result.byProject, [
    { projectNumber: "252035", days: 5 },
    { projectNumber: "", days: 3 },
  ]);
  assert.equal(result.otherDays, 8);
});

test("byProject est un tableau vide quand la personne n'a rien pose", () => {
  // La fenetre masque la section sur ce tableau vide : il ne doit jamais valoir
  // null ou undefined, sinon l'appelant doit se defendre a chaque rendu.
  assert.deepEqual(load({ columns: COLS_WITH_PROJECT }).byProject, []);
  assert.deepEqual(load({ allSegmentRows: null, columns: COLS_WITH_PROJECT }).byProject, []);
  assert.deepEqual(computeMonthLoad().byProject, []);
});

test("les numeros de projet arrivant en nombre depuis Grist sont normalises", () => {
  // Grist rend NumeroProjet tantot en nombre, tantot en chaine. 252035 et
  // "252035" designent le meme projet et doivent fusionner en UNE entree.
  const rows = [
    segment(1, "Marie Dupont", 3, { NumeroProjet: 252035 }),
    segment(2, "Marie Dupont", 2, { NumeroProjet: "252035" }),
  ];
  const result = load({ allSegmentRows: rows, columns: COLS_WITH_PROJECT });

  assert.deepEqual(result.byProject, [{ projectNumber: "252035", days: 5 }]);
});

// --- Libelles de la liste ----------------------------------------------------

test("formatLoadProjectEntries nomme les projets connus du catalogue", () => {
  const names = { 252035: "CHU Nantes" };
  const entries = formatLoadProjectEntries(
    [{ projectNumber: "252035", days: 9 }],
    (number) => names[number] || ""
  );

  assert.deepEqual(entries, [
    { projectNumber: "252035", days: 9, label: "252035 · CHU Nantes" },
  ]);
});

test("un numero absent du catalogue s'affiche nu, il ne disparait pas", () => {
  // Cas NORMAL : le catalogue ne porte que les projets visibles par cet
  // utilisateur (service courant, ACL), alors que la charge se compte tous
  // projets confondus. Masquer la ligne ferait chercher des jours manquants.
  const entries = formatLoadProjectEntries([{ projectNumber: "999999", days: 2 }], () => "");
  assert.deepEqual(entries, [{ projectNumber: "999999", days: 2, label: "999999" }]);
});

test("le seau sans numero recoit un libelle explicite", () => {
  const entries = formatLoadProjectEntries([{ projectNumber: "", days: 3 }], () => "Ignore");
  assert.deepEqual(entries, [
    { projectNumber: "", days: 3, label: "Projet non renseigne" },
  ]);
});

test("un catalogue qui jette ou qui manque fait retomber sur le numero nu", () => {
  const thrown = formatLoadProjectEntries([{ projectNumber: "252035", days: 1 }], () => {
    throw new Error("catalogue en cours de rechargement");
  });
  assert.equal(thrown[0].label, "252035");

  // Aucun resolveur fourni : la liste reste affichable.
  assert.equal(formatLoadProjectEntries([{ projectNumber: "252035", days: 1 }])[0].label, "252035");
  assert.deepEqual(formatLoadProjectEntries(null, () => ""), []);
});

// --- Index de surcharge ------------------------------------------------------
//
// Une barre de segment vire a l'ambre quand la PERSONNE est en surcharge sur le
// mois, tous projets confondus — pas quand le segment affiche depasse a lui seul
// (cela, c'est l'etat rouge « incoherent », qui reste distinct).
//
// L'index existe pour une raison de cout : un board affiche des dizaines de
// barres, et computeMonthLoad rebalaie TOUTE la table a chaque appel. Sans
// dedoublonnage par couple (personne, mois), le rendu serait quadratique.

test("l'index signale la surcharge d'une personne a cheval sur deux projets", () => {
  // 15 j sur un projet + 12 j sur un autre = 27 j pour 22 disponibles. Aucun des
  // deux segments ne depasse seul : c'est leur SOMME qui alerte.
  const rows = [
    segment(1, "Marie Dupont", 15, { NumeroProjet: "A" }),
    segment(2, "Marie Dupont", 12, { NumeroProjet: "B" }),
  ];
  const index = buildMonthOverloadIndex({
    entries: [{ personName: "Marie Dupont", monthKey: MONTH }],
    allSegmentRows: rows,
    columns: COLS,
  });

  assert.equal(index.isOverloaded("Marie Dupont", MONTH), true);
});

test("un mois PILE plein n'est pas une surcharge, un demi-jour de plus l'est", () => {
  // La frontiere exacte des 100 % appartient a l'etat « plein ». Sans la
  // tolerance de computeMonthLoad, une somme de flottants ferait basculer a tort.
  const full = buildMonthOverloadIndex({
    entries: [{ personName: "Marie Dupont", monthKey: MONTH }],
    allSegmentRows: [
      segment(1, "Marie Dupont", 14, { NumeroProjet: "A" }),
      segment(2, "Marie Dupont", 8, { NumeroProjet: "B" }),
    ],
    columns: COLS,
  });
  assert.equal(full.isOverloaded("Marie Dupont", MONTH), false);

  const over = buildMonthOverloadIndex({
    entries: [{ personName: "Marie Dupont", monthKey: MONTH }],
    allSegmentRows: [
      segment(1, "Marie Dupont", 14, { NumeroProjet: "A" }),
      segment(2, "Marie Dupont", 8.5, { NumeroProjet: "B" }),
    ],
    columns: COLS,
  });
  assert.equal(over.isOverloaded("Marie Dupont", MONTH), true);
});

test("les absences reduisent la capacite et peuvent creer la surcharge", () => {
  // 20 j poses sur un mois de 22 : rien a signaler. La personne pose ensuite tout
  // le mois en conge : sa capacite tombe a 0 et les memes 20 j deviennent une
  // surcharge, sans qu'aucun segment n'ait bouge.
  const rows = [segment(1, "Marie Dupont", 20, { NumeroProjet: "A" })];
  const entries = [{ personName: "Marie Dupont", monthKey: MONTH }];

  assert.equal(
    buildMonthOverloadIndex({ entries, allSegmentRows: rows, columns: COLS }).isOverloaded(
      "Marie Dupont",
      MONTH
    ),
    false
  );

  const absent = buildMonthOverloadIndex({
    entries,
    allSegmentRows: rows,
    columns: COLS,
    resolveAbsenceSet: () => fullMonthAbsence(),
  });
  assert.equal(absent.isOverloaded("Marie Dupont", MONTH), true);
});

test("getLoad rend de quoi ecrire l'infobulle", () => {
  // La couleur seule ne dit pas pourquoi : l'infobulle doit pouvoir annoncer
  // « N j sur M disponibles », sinon la cause (un AUTRE projet) reste invisible.
  const index = buildMonthOverloadIndex({
    entries: [{ personName: "Marie Dupont", monthKey: MONTH }],
    allSegmentRows: [
      segment(1, "Marie Dupont", 15, { NumeroProjet: "A" }),
      segment(2, "Marie Dupont", 12, { NumeroProjet: "B" }),
    ],
    columns: COLS,
  });

  const load = index.getLoad("Marie Dupont", MONTH);
  assert.equal(load.totalDays, 27);
  assert.equal(load.availableDays, 22);
  assert.equal(load.overloadDays, 5);
});

test("une paire absente de l'index ne surcharge rien et ne jette pas", () => {
  const index = buildMonthOverloadIndex({
    entries: [{ personName: "Marie Dupont", monthKey: MONTH }],
    allSegmentRows: [segment(1, "Marie Dupont", 30, { NumeroProjet: "A" })],
    columns: COLS,
  });

  assert.equal(index.isOverloaded("Jean Martin", MONTH), false);
  assert.equal(index.isOverloaded("Marie Dupont", "2026-10"), false);
  assert.equal(index.getLoad("Jean Martin", MONTH), null);
  assert.equal(buildMonthOverloadIndex().isOverloaded("Marie Dupont", MONTH), false);
});

test("le nom est apparie comme partout ailleurs : accents et casse ignores", () => {
  // Les segments viennent de TimeSegment, les noms affiches de Team : les deux
  // ne s'ecrivent pas toujours pareil. computeMonthLoad normalise deja, l'index
  // doit le faire aussi, sinon la barre resterait neutre en silence.
  const index = buildMonthOverloadIndex({
    entries: [{ personName: "MARIE DUPONT", monthKey: MONTH }],
    allSegmentRows: [segment(1, "Marie Dupont", 30, { NumeroProjet: "A" })],
    columns: COLS,
  });

  assert.equal(index.isOverloaded("marie dupont", MONTH), true);
  assert.equal(index.isOverloaded("MARIE DUPONT", MONTH), true);
});

test("un couple (personne, mois) repete n'est calcule qu'une fois", () => {
  // C'est la raison d'etre de l'index : sans dedoublonnage, un board de 40 barres
  // rebalaierait 40 fois la table entiere.
  let calls = 0;
  const rows = new Proxy([segment(1, "Marie Dupont", 30, { NumeroProjet: "A" })], {
    get(target, prop, receiver) {
      if (prop === Symbol.iterator) calls += 1;
      return Reflect.get(target, prop, receiver);
    },
  });

  buildMonthOverloadIndex({
    entries: [
      { personName: "Marie Dupont", monthKey: MONTH },
      { personName: "Marie Dupont", monthKey: MONTH },
      { personName: "Marie Dupont", monthKey: MONTH },
    ],
    allSegmentRows: rows,
    columns: COLS,
  });

  assert.equal(calls, 1, `la table a ete balayee ${calls} fois pour un seul couple`);
});
