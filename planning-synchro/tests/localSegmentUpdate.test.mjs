// Tests de la MISE A JOUR LOCALE post-ecriture — le noyau pur qui remplace le
// rechargement complet (`fetchProjectData()`) apres chaque ecriture TimeSegment.
//
// POURQUOI CE FICHIER EXISTE : jusqu'ici, valider la fenetre declenchait un
// re-fetch de tout le projet puis un re-rendu integral — le planning clignotait
// et la position de defilement sautait. Le jumeau gestion-depenses2, lui, applique
// la modification aux donnees deja en memoire et redessine. Ce module est la
// version planning-synchro de cette application locale.
//
// DEUX TABLEAUX, PAS UN : les lignes du PROJET affiche (le pane bas) et TOUTES
// les lignes TimeSegment tous projets confondus (la barre de charge mensuelle de
// la fenetre, cf. utils/monthLoad.js). Oublier le second ferait afficher des
// chiffres perimes des la premiere sauvegarde.

import { test } from "node:test";
import assert from "node:assert/strict";
import { applySegmentChangeLocally, timeSegmentRowsSignature } from "../assets/js/bottom/localSegmentUpdate.js";
import { computeTimeSegmentBounds } from "../assets/js/top/bounds.js";
import { buildWorkersFromSegments } from "../assets/js/bottom/chargeBoard.js";
import { toGristMonthValue } from "../assets/js/utils/monthSegments.js";

const COLUMNS = {
  id: "id",
  projectNumber: "NumeroProjet",
  name: "Name",
  mois: "Mois",
  startDate: "Start_At",
  endDate: "End_At",
  allocationDays: "Allocation_Days",
  effectif: "Effectif",
  label: "Label",
  service: "Service",
};

const PROJECT_NUMBER = "25-0142";

function segmentRow({ id, name = "Alice", monthKey = "2026-09", effectif = 5, projectNumber = PROJECT_NUMBER }) {
  return {
    id,
    NumeroProjet: projectNumber,
    Name: name,
    Mois: toGristMonthValue(monthKey),
    Allocation_Days: 22,
    Effectif: effectif,
  };
}

function baseState() {
  const projectRows = [segmentRow({ id: 41 }), segmentRow({ id: 42, name: "Bob", monthKey: "2026-10", effectif: 3 })];
  const allRows = [...projectRows, segmentRow({ id: 90, name: "Alice", monthKey: "2026-09", effectif: 4, projectNumber: "24-0007" })];
  return { projectRows, allRows };
}

function apply(change, state = baseState()) {
  return applySegmentChangeLocally({
    change,
    projectRows: state.projectRows,
    allRows: state.allRows,
    columns: COLUMNS,
    projectNumber: PROJECT_NUMBER,
  });
}

// --- CREATION ----------------------------------------------------------------

test("une creation ajoute la ligne aux deux tableaux, avec son id Grist", () => {
  const result = apply({
    type: "create",
    segmentId: 77,
    monthKey: "2026-11",
    workerName: "Chloe",
    effectif: 6,
  });

  assert.equal(result.applied, true);
  assert.equal(result.projectRows.length, 3);
  assert.equal(result.allRows.length, 4);

  const created = result.projectRows.at(-1);
  assert.equal(created.id, 77, "sans l'id Grist, la barre creee ne serait pas editable");
  assert.equal(created[COLUMNS.name], "Chloe");
  assert.equal(created[COLUMNS.projectNumber], PROJECT_NUMBER);
  assert.equal(created[COLUMNS.mois], toGristMonthValue("2026-11"));
  assert.equal(created[COLUMNS.effectif], 6);
  assert.equal(created[COLUMNS.allocationDays], 20, "novembre 2026 = 20 jours ouvres");
  assert.equal(
    result.allRows.at(-1).id,
    77,
    "la barre de charge mensuelle lit TOUTES les lignes : elle doit voir la creation"
  );
});

test("la ligne creee est immediatement exploitable par le rendu du pane bas", () => {
  const result = apply({
    type: "create",
    segmentId: 77,
    monthKey: "2026-11",
    workerName: "Chloe",
    effectif: 6,
  });

  const workers = buildWorkersFromSegments(result.projectRows, [], { timeSegment: COLUMNS, projectTeam: {} });
  const chloe = workers.find((worker) => worker.name === "Chloe");
  assert.ok(chloe, "la personne creee doit apparaitre dans le pane bas sans rechargement");
  assert.equal(chloe.segments.length, 1);
  assert.equal(chloe.segments[0].id, 77);
  assert.equal(chloe.segments[0].monthKey, "2026-11");
});

test("une creation hors des bornes actuelles elargit les bornes de la frise", () => {
  const state = baseState();
  const before = computeTimeSegmentBounds(state.projectRows, COLUMNS);
  assert.equal(before.endDate, "2026-10-31");

  const result = apply({ type: "create", segmentId: 77, monthKey: "2027-02", workerName: "Chloe", effectif: 6 }, state);
  const after = computeTimeSegmentBounds(result.projectRows, COLUMNS);

  assert.equal(after.startDate, "2026-09-01");
  assert.equal(after.endDate, "2027-02-28", "la frise doit couvrir le mois qui vient d'apparaitre");
});

test("une creation sans id Grist exploitable n'est pas appliquee localement", () => {
  // `createTimeSegment` renvoie l'id du nouvel enregistrement ; s'il manque, la
  // barre creee ne serait pas editable — mieux vaut un repli sur le rechargement
  // complet qu'une barre morte.
  const result = apply({ type: "create", segmentId: null, monthKey: "2026-11", workerName: "Chloe", effectif: 6 });

  assert.equal(result.applied, false, "l'appelant doit pouvoir retomber sur un rechargement");
  assert.equal(result.projectRows.length, 2, "aucune ligne fantome ajoutee");
  assert.equal(result.allRows.length, 3);
});

// --- MISE A JOUR -------------------------------------------------------------

test("une mise a jour modifie la ligne dans les deux tableaux", () => {
  const result = apply({
    type: "update",
    segmentId: 41,
    monthKey: "2026-09",
    workerName: "Alice",
    effectif: 12,
  });

  assert.equal(result.applied, true);
  assert.equal(result.projectRows.length, 2, "une mise a jour ne cree aucune ligne");

  const updatedProjectRow = result.projectRows.find((row) => row.id === 41);
  assert.equal(updatedProjectRow[COLUMNS.effectif], 12);
  assert.equal(updatedProjectRow[COLUMNS.mois], toGristMonthValue("2026-09"));

  const updatedAllRow = result.allRows.find((row) => row.id === 41);
  assert.equal(updatedAllRow[COLUMNS.effectif], 12, "la barre de charge doit voir le nouvel effectif");
  assert.equal(
    result.allRows.find((row) => row.id === 90)[COLUMNS.effectif],
    4,
    "la ligne d'un autre projet n'est pas touchee"
  );
});

test("un id de segment en chaine (dataset DOM) apparie bien la ligne", () => {
  const result = apply({ type: "update", segmentId: "41", monthKey: "2026-09", workerName: "Alice", effectif: 9 });

  assert.equal(result.applied, true);
  assert.equal(result.projectRows.find((row) => row.id === 41)[COLUMNS.effectif], 9);
});

test("une mise a jour peut deplacer la ligne d'un mois a l'autre", () => {
  const result = apply({ type: "update", segmentId: 41, monthKey: "2026-12", workerName: "Alice", effectif: 5 });

  const updated = result.projectRows.find((row) => row.id === 41);
  assert.equal(updated[COLUMNS.mois], toGristMonthValue("2026-12"));
  assert.equal(updated[COLUMNS.allocationDays], 22, "decembre 2026 = 22 jours ouvres");
});

test("une mise a jour d'une ligne inconnue n'est pas appliquee localement", () => {
  const result = apply({ type: "update", segmentId: 999, monthKey: "2026-09", workerName: "Alice", effectif: 2 });

  assert.equal(result.applied, false, "etat local desynchronise : il faut recharger");
  assert.equal(result.projectRows.length, 2);
});

// --- SUPPRESSION -------------------------------------------------------------

test("une suppression retire la ligne des deux tableaux", () => {
  const result = apply({ type: "delete", segmentId: 41 });

  assert.equal(result.applied, true);
  assert.deepEqual(
    result.projectRows.map((row) => row.id),
    [42]
  );
  assert.deepEqual(
    result.allRows.map((row) => row.id),
    [42, 90],
    "la barre de charge mensuelle ne doit plus compter la ligne supprimee"
  );
});

test("une suppression d'une ligne inconnue n'est pas appliquee localement", () => {
  const result = apply({ type: "delete", segmentId: 999 });
  assert.equal(result.applied, false);
});

// --- ROBUSTESSE --------------------------------------------------------------

test("un changement absent ou de type inconnu retombe sur le rechargement", () => {
  assert.equal(apply(null).applied, false);
  assert.equal(apply({ type: "renommer", segmentId: 41 }).applied, false);
});

// --- EMPREINTE D'UN JEU DE LIGNES --------------------------------------------
//
// Le relais de synchronisation reveille aussi ce widget apres SA PROPRE ecriture.
// La relecture qui suit ramene alors exactement ce que la mise a jour locale
// ci-dessus vient d'afficher : la comparer permet de ne PAS redessiner, donc de
// ne pas faire clignoter le pane bas. Un changement venu d'ailleurs, lui, change
// l'empreinte et redessine toujours — contrairement a un jeton « ignorer le
// prochain signal », qui avalerait l'ecriture simultanee d'un autre utilisateur.

test("deux jeux de lignes identiques ont la meme empreinte, quel que soit l'ordre", () => {
  const { allRows } = baseState();
  const shuffled = [allRows[2], allRows[0], allRows[1]];

  assert.equal(
    timeSegmentRowsSignature(allRows, COLUMNS),
    timeSegmentRowsSignature(shuffled, COLUMNS),
    "Grist a son propre tri : l'ordre ne doit pas compter"
  );
});

test("la ligne creee localement a la meme empreinte que celle que Grist renverra", () => {
  // C'est LA comparaison qui evite le second rendu apres notre propre ecriture.
  const state = baseState();
  const applied = apply(
    { type: "create", segmentId: 77, monthKey: "2026-11", workerName: "Chloe", effectif: 6 },
    state
  );
  const fromGrist = [
    ...state.allRows,
    {
      id: 77,
      NumeroProjet: PROJECT_NUMBER,
      Name: "Chloe",
      Mois: toGristMonthValue("2026-11"),
      Allocation_Days: 20,
      Effectif: 6,
      // Colonnes que Grist renvoie en plus et qu'aucun lecteur du plan de charge
      // ne relit : elles ne doivent pas faire croire a un changement.
      Label: "",
      Service: "Structure",
      End_At: null,
    },
  ];

  assert.equal(
    timeSegmentRowsSignature(applied.allRows, COLUMNS),
    timeSegmentRowsSignature(fromGrist, COLUMNS)
  );
});

test("tout changement visible a l'ecran change l'empreinte", () => {
  const { allRows } = baseState();
  const reference = timeSegmentRowsSignature(allRows, COLUMNS);

  const changed = [
    ["un effectif", allRows.map((row, index) => (index ? row : { ...row, Effectif: 9 }))],
    ["un mois", allRows.map((row, index) => (index ? row : { ...row, Mois: toGristMonthValue("2026-12") }))],
    ["une personne", allRows.map((row, index) => (index ? row : { ...row, Name: "Zoe" }))],
    ["un projet", allRows.map((row, index) => (index ? row : { ...row, NumeroProjet: "24-0007" }))],
    ["une date legacy", allRows.map((row, index) => (index ? row : { ...row, Start_At: 1756684800 }))],
    // `Label` EST affiche : chargeBoard.js le lit (buildWorkersFromSegments) et
    // s'en sert comme texte de la barre (`segment?.label || "X j"`). Un libelle
    // change ailleurs doit donc redessiner, sinon il reste perime a l'ecran
    // jusqu'au prochain changement d'une AUTRE colonne.
    ["un libelle", allRows.map((row, index) => (index ? row : { ...row, Label: "Chantier Nord" }))],
    ["une suppression", allRows.slice(1)],
    ["un ajout", [...allRows, segmentRow({ id: 123, name: "Zoe" })]],
  ];

  changed.forEach(([label, rows]) => {
    assert.notEqual(
      timeSegmentRowsSignature(rows, COLUMNS),
      reference,
      `${label} doit rendre l'empreinte differente, sinon le changement resterait invisible`
    );
  });
});

test("l'empreinte tolere une entree absente ou non tableau", () => {
  assert.equal(timeSegmentRowsSignature(undefined, COLUMNS), "");
  assert.equal(timeSegmentRowsSignature(null, COLUMNS), "");
  assert.equal(timeSegmentRowsSignature([], COLUMNS), "");
});

// --- GARDE DE CABLAGE --------------------------------------------------------
//
// Ce module peut rester parfait pendant que main.js continue de recharger tout le
// projet apres chaque ecriture — c'est exactement l'etat d'avant. Ce raccord n'est
// PLUS epingle ici : la garde textuelle qui vivait a cet endroit decoupait le
// corps de `onChanged` et verifiait l'absence de la chaine « fetchProjectData ».
// Le fetch avait simplement demenage dans `reloadChargeFromGrist()`, appelee par
// ce meme gestionnaire : la regle metier n'etait pas testee, seul le jeton
// l'etait. Le chemin post-ecriture est desormais EXECUTE, pas relu, dans
// tests/postWriteRefresh.test.mjs.

test("les tableaux d'origine ne sont jamais mutes sur place", () => {
  const state = baseState();
  const projectRowsBefore = state.projectRows;
  const allRowsBefore = state.allRows;
  const effectifBefore = state.projectRows[0][COLUMNS.effectif];

  const result = apply({ type: "update", segmentId: 41, monthKey: "2026-09", workerName: "Alice", effectif: 12 }, state);

  assert.notEqual(result.projectRows, projectRowsBefore, "un nouveau tableau, pas une mutation");
  assert.notEqual(result.allRows, allRowsBefore);
  assert.equal(
    projectRowsBefore[0][COLUMNS.effectif],
    effectifBefore,
    "une fermeture qui tiendrait encore l'ancien tableau ne doit pas voir la modification"
  );
});
