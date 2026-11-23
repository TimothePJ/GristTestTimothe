// Recherche d'un plan (fenetre « Rechercher un plan » du graphique des depenses).
//
// Les plans et leurs dates viennent du code de planning-synchro, sans copie :
// buildChartTasks (une tache = une barre principale du planning, datee comme
// elle) et smoothTasks (lissage de Projets2.Lissage). Les tests comparent donc
// le resultat a ces fonctions memes, en plus de valeurs attendues ecrites en dur.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  buildPlanSearchData,
  filterPlans,
  getPlanFilterOptions,
} from "../assets/js/utils/planSearch.js";
import { createPlanSearchModal, renderPlanSearchResults } from "../assets/js/ui/planSearchModal.js";
import { APP_CONFIG } from "../assets/js/config.js";
import { buildExpenseData } from "../assets/js/services/projectService.js";
import { buildChartTasks } from "../../planning-synchro/assets/js/top/taskLoadModel.js";
import { smoothTasks } from "../../planning-synchro/assets/js/top/taskSmoothing.js";

const TODAY = "2026-11-09";
const PROJECT = { id: 7, name: "ERA QUAI D'ORSAY", projectNumber: "252035" };

function row(fields) {
  return { NomProjet: PROJECT.name, Service: "Structure", ...fields };
}

// Dates en 2027 : toutes a venir, donc mobiles pour le lissage.
const PLANNING_ROWS = [
  row({ id: 1, ID2: "101", Taches: "NDC mur A", Type_doc: "NDC", Zone: "Zone A", Duree_1: 1, Diff_coffrage: "2027-03-02" }),
  row({ id: 2, ID2: "102", Taches: "NDC mur B", Type_doc: "NDC", Zone: "Zone B", Duree_1: 1, Diff_coffrage: "2027-03-09" }),
  row({ id: 3, ID2: "103", Taches: "Coupes dalle", Type_doc: "COUPES", Zone: "Zone A", Date_limite: "2027-03-01", Diff_coffrage: "2027-03-16" }),
  row({ id: 4, ID2: "104", Taches: "NDC voile", Type_doc: "NDC", Zone: "Zone B", Duree_1: 1, Diff_coffrage: "2027-03-23" }),
  // Indice A = cible par defaut d'un coffrage : plan realise.
  row({ id: 5, ID2: "105", Taches: "Coffrage réalisé", Type_doc: "COFFRAGE", Zone: "Zone A", Date_limite: "2027-04-01", Diff_coffrage: "2027-04-20", Indice: "A" }),
  // Autre projet : jamais dans la recherche.
  { id: 9, NomProjet: "AUTRE PROJET", Service: "Structure", ID2: "900", Taches: "Ailleurs", Type_doc: "NDC", Duree_1: 1, Diff_coffrage: "2027-03-05" },
];

const LISSAGE_MAX_2 = JSON.stringify({ version: 1, services: { Structure: { maxTotal: 2 } } });

// `project` a la forme des projets de buildExpenseData : la cellule
// Projets2.Lissage y voyage comme Projets2.Avancement.
function searchData({ lissage = LISSAGE_MAX_2, service = "Structure", rows = PLANNING_ROWS } = {}) {
  return buildPlanSearchData({
    planningRows: rows,
    project: { ...PROJECT, avancementConfigRaw: "", lissageConfigRaw: lissage },
    service,
    todayIso: TODAY,
  });
}

test("buildExpenseData garde la cellule Projets2.Lissage du projet", () => {
  const { projects } = buildExpenseData({
    projectRows: [{ id: 7, Numero_de_projet: "252035", Nom_de_projet: PROJECT.name, Lissage: LISSAGE_MAX_2 }],
  });

  assert.equal(projects[0].lissageConfigRaw, LISSAGE_MAX_2);
});

const numbers = (plans) => plans.map((plan) => plan.number);

test("les plans sont ceux que dessine planning-synchro, avec les memes dates", () => {
  const { plans } = searchData({ lissage: "" });
  const projectRows = PLANNING_ROWS.filter((planningRow) => planningRow.NomProjet === PROJECT.name);
  const chartTasks = buildChartTasks(projectRows, { project: PROJECT.name });

  assert.deepEqual(
    plans.map((plan) => [plan.rowId, plan.number, plan.name, plan.zone, plan.type, plan.dueIso]),
    chartTasks.map((task) => [task.rowId, task.id2, task.name, task.zone, task.type, task.dueIso])
  );
  assert.deepEqual(numbers(plans), ["101", "102", "103", "104", "105"]);
  assert.equal(plans.find((plan) => plan.number === "101").dueIso, "2027-03-02");
});

test("seules les lignes du projet affiche sont cherchables", () => {
  const { plans } = searchData();

  assert.equal(plans.some((plan) => plan.number === "900"), false);
});

test("un plan realise est marque comme tel, avec son avancement", () => {
  const { plans } = searchData({ lissage: "" });
  const realised = plans.find((plan) => plan.number === "105");

  assert.equal(realised.realized, true);
  assert.equal(realised.progress, 100);
  assert.equal(plans.find((plan) => plan.number === "101").realized, false);
});

test("avec un lissage regle pour le service, chaque plan porte sa date lissee (calcul de planning-synchro)", () => {
  const data = searchData();
  const projectRows = PLANNING_ROWS.filter((planningRow) => planningRow.NomProjet === PROJECT.name);
  const smoothed = smoothTasks(
    buildChartTasks(projectRows, { project: PROJECT.name }),
    { maxTotal: 2, maxByType: {} },
    TODAY
  );

  assert.equal(data.lissageActive, true);
  assert.deepEqual(
    data.plans.map((plan) => [plan.rowId, plan.smoothedIso, plan.monthsAdvanced, plan.moved]),
    smoothed.tasks.map((task) => [task.rowId, task.smoothedIso, task.monthsAdvanced, task.moved])
  );
  // Mars 2027 compte 4 plans pour un maximum de 2 : les deux premiers avancent.
  const moved = data.plans.filter((plan) => plan.moved);
  assert.deepEqual(numbers(moved), ["101", "102"]);
  moved.forEach((plan) => {
    assert.equal(plan.smoothedIso.slice(0, 7), "2027-02");
    assert.equal(plan.monthsAdvanced, 1);
  });
  assert.equal(data.movedCount, 2);
});

test("sans lissage regle pour le service affiche, aucune date lissee", () => {
  const data = searchData({ service: "Synthese" });

  assert.equal(data.lissageActive, false);
  assert.equal(data.movedCount, 0);
  data.plans.forEach((plan) => {
    assert.equal(plan.smoothedIso, null);
    assert.equal(plan.moved, false);
  });
});

test("cellule Lissage absente ou illisible : pas de lissage, pas d'erreur", () => {
  [null, "", "{pas du json"].forEach((lissage) => {
    const data = searchData({ lissage });
    assert.equal(data.lissageActive, false);
    assert.equal(data.plans.length, 5);
  });
});

test("filtre par numero : le numero saisi est cherche dans le N° du plan", () => {
  const { plans } = searchData();

  assert.deepEqual(numbers(filterPlans(plans, { number: "103" })), ["103"]);
  assert.deepEqual(numbers(filterPlans(plans, { number: " 10 " })), ["101", "102", "103", "104", "105"]);
  assert.deepEqual(numbers(filterPlans(plans, { number: "999" })), []);
});

test("filtre par nom : sans tenir compte des accents ni des majuscules", () => {
  const { plans } = searchData();

  assert.deepEqual(numbers(filterPlans(plans, { name: "MUR" })), ["101", "102"]);
  assert.deepEqual(numbers(filterPlans(plans, { name: "realise" })), ["105"]);
});

test("numero et nom ensemble : les deux doivent correspondre", () => {
  const { plans } = searchData();

  assert.deepEqual(numbers(filterPlans(plans, { number: "10", name: "voile" })), ["104"]);
  assert.deepEqual(numbers(filterPlans(plans, { number: "101", name: "voile" })), []);
});

test("filtres zone, type de document et etat", () => {
  const { plans } = searchData();

  assert.deepEqual(numbers(filterPlans(plans, { zone: "Zone A" })), ["101", "103", "105"]);
  assert.deepEqual(numbers(filterPlans(plans, { type: "NDC" })), ["101", "102", "104"]);
  assert.deepEqual(numbers(filterPlans(plans, { zone: "Zone B", type: "NDC" })), ["102", "104"]);
  assert.deepEqual(numbers(filterPlans(plans, { status: "realises" })), ["105"]);
  assert.deepEqual(numbers(filterPlans(plans, { status: "a-faire" })), ["101", "102", "103", "104"]);
  assert.deepEqual(numbers(filterPlans(plans, { status: "avances" })), ["101", "102"]);
  assert.deepEqual(numbers(filterPlans(plans, {})), ["101", "102", "103", "104", "105"]);
});

test("les listes de filtres ne proposent que les zones et types presents", () => {
  const { plans } = searchData();
  const options = getPlanFilterOptions(plans);

  assert.deepEqual(options.zones, ["Zone A", "Zone B"]);
  // Ordre et libelles du graphique de planning-synchro (TYPE_ORDER / TYPE_META).
  assert.deepEqual(options.types, [
    { value: "COFFRAGE", label: "Coffrage" },
    { value: "NDC", label: "NDC" },
    { value: "COUPES", label: "Coupes" },
  ]);
});

test("resultats : date sans lissage et date lissee cote a cote quand un lissage existe", () => {
  const data = searchData();
  const html = renderPlanSearchResults({ plans: data.plans, lissageActive: true });

  assert.match(html, /Échéance lissée/);
  assert.match(html, /02\/03\/2027/);
  assert.match(html, /1 mois plus tôt/);
  assert.match(html, /class="plan-search-row is-realized"/);
});

test("resultats : sans lissage, pas de colonne de date lissee", () => {
  const data = searchData({ lissage: "" });
  const html = renderPlanSearchResults({ plans: data.plans, lissageActive: false });

  assert.doesNotMatch(html, /Échéance lissée/);
  assert.match(html, /NDC mur A/);
});

test("resultats : les textes des plans sont echappes", () => {
  const data = searchData({
    lissage: "",
    rows: [row({ id: 1, ID2: "1<b>", Taches: "Mur <script>", Type_doc: "NDC", Zone: "A & B", Duree_1: 1, Diff_coffrage: "2027-03-02" })],
  });
  const html = renderPlanSearchResults({ plans: data.plans, lissageActive: false });

  assert.doesNotMatch(html, /<script>|1<b>/);
  assert.match(html, /Mur &lt;script&gt;/);
  assert.match(html, /A &amp; B/);
});

test("resultats vides : un message dit quoi changer", () => {
  assert.match(
    renderPlanSearchResults({ plans: [], lissageActive: false }),
    /Aucun plan ne correspond/
  );
});

// La fenetre arrive masquee par son style (display: none) mais sans `hidden` :
// elle doit se savoir fermee des sa creation, sinon Echap (main.js) la fermerait
// « en premier » au lieu des autres fenetres, et chaque rendu la recalculerait.
test("la fenetre de recherche est fermee des sa creation", () => {
  const attributes = {};
  const root = {
    hidden: false,
    style: { display: "none", removeProperty() {} },
    querySelector: () => null,
    addEventListener() {},
    setAttribute(name, value) {
      attributes[name] = value;
    },
  };
  let reads = 0;
  const modal = createPlanSearchModal({ root, getData: () => { reads += 1; return null; } });

  assert.equal(modal.isOpen(), false);
  assert.equal(root.hidden, true);
  assert.equal(attributes["aria-hidden"], "true");
  modal.refresh();
  assert.equal(reads, 0, "une fenetre fermee ne recalcule rien");
});

function fakeElementClass() {
  return class FakeElement {
    constructor() {
      this.innerHTML = "";
    }
  };
}

test("la loupe n'apparait que dans gestion-depenses2 (pas dans Gestion-globale)", async () => {
  const previousHTMLElement = globalThis.HTMLElement;
  globalThis.HTMLElement = fakeElementClass();
  try {
    const { renderSpendingChartControls } = await import("../assets/js/ui/chart.js");
    const withSearch = new globalThis.HTMLElement();
    const withoutSearch = new globalThis.HTMLElement();
    renderSpendingChartControls(withSearch, { showPlanSearch: true });
    renderSpendingChartControls(withoutSearch);

    assert.match(withSearch.innerHTML, /class="plan-search-open-btn"/);
    assert.match(withSearch.innerHTML, /aria-label="Rechercher un plan"/);
    assert.doesNotMatch(withoutSearch.innerHTML, /plan-search-open-btn/);
    assert.match(withoutSearch.innerHTML, /Colonnes depuis le haut/);
  } finally {
    globalThis.HTMLElement = previousHTMLElement;
  }
});

const read = (relativePath) =>
  fs.readFileSync(new URL(relativePath, import.meta.url), "utf8");

test("la fenetre est dans la page et branchee au widget", () => {
  const html = read("../index.html");
  const main = read("../assets/js/main.js");

  ["plan-search-modal", "plan-search-number", "plan-search-name", "plan-search-zone",
    "plan-search-type", "plan-search-status", "plan-search-results"].forEach((id) => {
    assert.match(html, new RegExp(`id="${id}"`), `#${id} manquant`);
  });
  assert.equal(APP_CONFIG.grist.columns.projects.lissage, "Lissage");
  assert.match(main, /renderSpendingChartControls\(dom\.spendingChartControls, \{ showPlanSearch: true \}\)/);
  assert.doesNotMatch(main, /renderSpendingChartControls\(dom\.spendingChartControls\)/);
  // Les lignes Planning_Projet brutes sont gardees pour la recherche.
  assert.match(main, /planningProjectRows: dataTables\.planningProjectRows/);
  // Echap ferme la fenetre de recherche en premier.
  assert.match(main, /if \(planSearch\.isOpen\(\)\) \{\s*planSearch\.close\(\);\s*return;/);
});
