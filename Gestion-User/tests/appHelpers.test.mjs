// app.js pilote le DOM et s'auto-demarre a l'import : impossible de le charger
// sous `node --test`. Ses fonctions pures sont pourtant celles qui ont vide la
// matrice quand la tache 7 a supprime startTime/endTime, et celles qui portent
// desormais l'etat « Congé ». On extrait donc leur texte source et on l'evalue.
//
// L'extraction echoue BRUYAMMENT si une fonction est renommee ou reecrite : un
// motif introuvable ne doit jamais se lire « aucun test ne tombe ».
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { getMonthBounds } from "../assets/js/monthSegments.js";

const APP_SOURCE = readFileSync(
  fileURLToPath(new URL("../assets/js/app.js", import.meta.url)),
  "utf8"
);

// Le fichier est en CRLF alors que le reste du widget est en LF : les motifs
// s'ancrent donc sur `^`/`$` en mode multiligne, jamais sur "\n" litteral.
function extractFunction(name) {
  const match = APP_SOURCE.match(new RegExp(`^function ${name}\\([\\s\\S]*?^\\}`, "m"));
  assert.ok(
    match,
    `fonction ${name} introuvable dans app.js : test a reparer, pas a ignorer`
  );
  return match[0];
}

function buildFromSource(names, exported, ...args) {
  const body = names.map(extractFunction).join("\n");
  // eslint-disable-next-line no-new-func -- source du depot, jamais une entree utilisateur
  return new Function(...args.map(([key]) => key), `${body}\nreturn ${exported};`)(
    ...args.map(([, value]) => value)
  );
}

const segmentOverlapsRange = buildFromSource(
  ["segmentOverlapsRange"],
  "segmentOverlapsRange",
  ["getMonthBounds", getMonthBounds]
);

const getSegmentYearBounds = buildFromSource(
  ["getSegmentYearBounds"],
  "getSegmentYearBounds"
);

// Fenetre visible du widget pour l'annee 2026 : de la semaine 1 (qui commence
// le 29/12/2025) a la fin de la semaine 53.
const VUE_2026 = { start: new Date(2025, 11, 29), end: new Date(2027, 0, 4) };

// =====================================================================
// REGRESSION CRITIQUE — segmentOverlapsRange lisait segment.startTime,
// devenu undefined : la comparaison etait toujours fausse, TOUS les
// segments etaient filtres et la matrice s'affichait vide. Ce n'etait pas
// une degradation douce, d'ou ces tests.
// =====================================================================
test("un segment du mois affiche reste visible", () => {
  assert.equal(segmentOverlapsRange({ monthKey: "2026-09" }, VUE_2026), true);
  assert.equal(segmentOverlapsRange({ monthKey: "2026-01" }, VUE_2026), true);
  assert.equal(segmentOverlapsRange({ monthKey: "2026-12" }, VUE_2026), true);
});

test("les mois de bord partages avec les semaines ISO restent visibles", () => {
  // La semaine 1 de 2026 commence le 29/12/2025 : decembre 2025 est visible.
  assert.equal(segmentOverlapsRange({ monthKey: "2025-12" }, VUE_2026), true);
  // La semaine 53 se termine le 03/01/2027 : janvier 2027 l'est aussi.
  assert.equal(segmentOverlapsRange({ monthKey: "2027-01" }, VUE_2026), true);
});

test("un segment hors fenetre est bien ecarte", () => {
  assert.equal(segmentOverlapsRange({ monthKey: "2025-11" }, VUE_2026), false);
  assert.equal(segmentOverlapsRange({ monthKey: "2027-02" }, VUE_2026), false);
});

test("un monthKey absent ou illisible n'est pas visible et ne leve rien", () => {
  for (const monthKey of [undefined, null, "", "2026", "abcd-09", "2026-13"]) {
    assert.equal(segmentOverlapsRange({ monthKey }, VUE_2026), false, `monthKey ${monthKey}`);
  }
  assert.equal(segmentOverlapsRange({ monthKey: "2026-09" }, null), false);
});

// =====================================================================
// Le selecteur d'annee lisait lui aussi startDate/endDate. Il degradait
// proprement — il ne proposait plus que l'annee courante — mais masquait
// alors toute planification passee ou future.
// =====================================================================
test("les annees proposees couvrent les mois planifies", () => {
  const anneeCourante = new Date().getFullYear();
  const bounds = getSegmentYearBounds([{ monthKey: "2024-03" }, { monthKey: "2028-11" }]);

  assert.equal(bounds.minYear, 2023, "une marge d'un an avant le plus ancien mois");
  assert.equal(bounds.maxYear, 2029, "une marge d'un an apres le plus recent");
  assert.ok(bounds.minYear < anneeCourante && bounds.maxYear > anneeCourante);
});

test("les mois illisibles sont ignores sans faire deriver les bornes", () => {
  const anneeCourante = new Date().getFullYear();
  const bounds = getSegmentYearBounds([
    { monthKey: "" },
    { monthKey: null },
    { monthKey: "pas-un-mois" },
    {},
  ]);

  assert.equal(bounds.minYear, anneeCourante - 1);
  assert.equal(bounds.maxYear, anneeCourante + 1);
  assert.ok(Number.isInteger(bounds.minYear), "borne NaN : le selecteur d'annee serait vide");
  assert.ok(Number.isInteger(bounds.maxYear));
});

// =====================================================================
// L'etat « Congé ». Un 0 % se lirait « disponible », soit l'inverse de la
// realite : c'est la cellule elle-meme qui doit changer de nature.
// =====================================================================
class FakeClassList {
  constructor() { this.names = new Set(); }
  add(...names) { names.forEach((name) => this.names.add(name)); }
  contains(name) { return this.names.has(name); }
}

const fakeDocument = {
  createElement(tagName) {
    return { tagName, className: "", classList: new FakeClassList(), title: "", textContent: "" };
  },
};

const createPercentCell = buildFromSource(
  ["getRoundedPercent", "applyTotalCellClass", "formatLeaveDays", "createPercentCell"],
  "createPercentCell",
  ["document", fakeDocument]
);

const SEMAINE = { value: "2026-W37" };

test("une semaine a capacite nulle affiche « Congé », jamais 0", () => {
  for (const type of ["project", "total", "empty"]) {
    const cell = createPercentCell(
      { type, weekPercents: { "2026-W37": 0 }, weekStates: { "2026-W37": "leave" } },
      SEMAINE
    );

    assert.equal(cell.textContent, "Congé", `type ${type}`);
    assert.notEqual(cell.textContent, "0");
    assert.ok(cell.classList.contains("is-leave"), `classe is-leave absente pour ${type}`);
    assert.equal(cell.title, "Semaine non travaillee");
    // L'etat « conge » ne doit pas etre repeint en charge partielle/equilibree.
    assert.ok(!cell.classList.contains("is-partial"));
    assert.ok(!cell.classList.contains("is-balanced"));
  }
});

// Capacite nulle ET jours planifies : aucun pourcentage n'est calculable, donc
// sans signal propre la charge n'apparait NULLE PART dans la matrice.
test("une semaine en conge portant de la charge le signale, jours compris", () => {
  for (const type of ["project", "total"]) {
    const cell = createPercentCell(
      {
        type,
        weekPercents: { "2026-W37": 0 },
        weekStates: { "2026-W37": "leave-overloaded" },
        weekLeaveDays: { "2026-W37": 3.6363636 },
      },
      SEMAINE
    );

    assert.ok(cell.classList.contains("is-leave"), `is-leave absente pour ${type}`);
    assert.ok(
      cell.classList.contains("is-leave-overloaded"),
      `charge invisible : is-leave-overloaded absente pour ${type}`
    );
    assert.match(
      cell.title,
      /3,6 j/,
      `le title n'indique pas les jours planifies (${cell.title})`
    );
    assert.notEqual(cell.textContent, "0");
    assert.ok(!cell.classList.contains("is-balanced"));
    assert.ok(!cell.classList.contains("is-partial"));
  }
});

test("une semaine travaillee sans charge reste vide, pas « Congé »", () => {
  const cell = createPercentCell(
    { type: "project", weekPercents: { "2026-W37": 0 }, weekStates: { "2026-W37": "" } },
    SEMAINE
  );

  assert.equal(cell.textContent, "");
  assert.ok(!cell.classList.contains("is-leave"));
});

test("une cellule sans weekStates continue de s'afficher normalement", () => {
  // Robustesse : un appelant qui n'aurait pas encore migre ne doit pas casser.
  const cell = createPercentCell({ type: "project", weekPercents: { "2026-W37": 45.4 } }, SEMAINE);

  assert.equal(cell.textContent, "45");
  assert.ok(cell.classList.contains("has-value"));
});

test("les etats de charge existants ne sont pas alteres", () => {
  const partiel = createPercentCell(
    { type: "total", weekPercents: { "2026-W37": 60 }, weekStates: { "2026-W37": "" } },
    SEMAINE
  );
  assert.equal(partiel.textContent, "60");
  assert.ok(partiel.classList.contains("is-partial"));

  const surcharge = createPercentCell(
    { type: "total", weekPercents: { "2026-W37": 150 }, weekStates: { "2026-W37": "" } },
    SEMAINE
  );
  assert.equal(surcharge.textContent, "150");
  assert.ok(surcharge.classList.contains("is-overload"));
});

// =====================================================================
// Filet anti-rechute : plus aucun champ supprime par la tache 7 ne doit
// etre relu dans app.js. Ce sont ces lectures qui ont vide la matrice.
// =====================================================================
test("app.js ne lit plus aucun champ supprime par le modele mensuel", () => {
  for (const champ of [
    "segment.startTime",
    "segment.endTime",
    "segment.startDate",
    "segment.endDate",
    "segment.allocationDays",
    "segment.fullHalfDayUnits",
  ]) {
    assert.ok(
      !APP_SOURCE.includes(champ),
      `app.js lit encore ${champ}, supprime par le modele « un segment = un mois »`
    );
  }
});

test("le service d'utilisation recoit bien l'index d'absences", () => {
  // Sans ce cablage la matrice calculerait une capacite theorique pour tout le
  // monde : les tests de utilizationService resteraient verts, le widget faux.
  assert.match(
    APP_SOURCE,
    /computeWeeklyUtilizationMatrix\(\{[\s\S]*?absencesByEmployee: state\.data\.absencesByEmployee[\s\S]*?\}\)/,
    "app.js ne transmet plus absencesByEmployee a computeWeeklyUtilizationMatrix"
  );
});
