// Dates d'une ligne de Planning_Projet liée à une tâche MS Project. C'est la SEULE règle :
// le dépôt dans Planning Projet, l'import XML et l'édition d'une date dans MS Project
// doivent tous trois trouver les mêmes dates.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildMsLinkedPlanningDateFields,
  computeMsLinkedPlanningDates,
  keepChangedPlanningDateFields,
} from "../assets/js/utils/msProjectPlanningDates.js";

// Une colonne Date Grist : secondes depuis 1970, à minuit UTC.
const gristSeconds = (year, month, date) => Date.UTC(year, month - 1, date) / 1000;

test("coffrage : démarrage = début MS, diffusion = démarrage − durée 3, date limite = diffusion − durée 1", () => {
  assert.deepEqual(
    computeMsLinkedPlanningDates({
      typeDoc: "COFFRAGE",
      msStart: "2026-09-21",
      msEnd: "2026-09-25",
      duree1: 2,
      duree3: 3,
    }),
    { demarrage: "2026-09-21", diffCoffrage: "2026-08-31", dateLimite: "2026-08-17" }
  );
});

for (const typeDoc of ["NDC", "Note de calcul", "COUPES", "DEMOLITION", "Plan de phasage"]) {
  test(`${typeDoc} : même calcul que le coffrage, la date limite et la diffusion suivent le démarrage`, () => {
    assert.deepEqual(
      computeMsLinkedPlanningDates({
        typeDoc,
        msStart: "2026-09-21",
        msEnd: "2026-09-25",
        dateLimite: "2026-01-05",
        diffCoffrage: "2026-01-19",
        duree1: 2,
        duree3: 3,
      }),
      { demarrage: "2026-09-21", diffCoffrage: "2026-08-31", dateLimite: "2026-08-17" }
    );
  });
}

test("armatures : diffusion armatures = démarrage − durée 3, diffusion coffrage = diffusion armatures − durée 2", () => {
  assert.deepEqual(
    computeMsLinkedPlanningDates({
      typeDoc: "ARMATURES",
      msStart: "2026-09-21",
      msEnd: "2026-09-25",
      dateLimite: "2026-01-05",
      duree2: 4,
      duree3: 1,
    }),
    { demarrage: "2026-09-21", diffArmature: "2026-09-14", diffCoffrage: "2026-08-17" }
  );
});

test("coffrage sans durée 3 : la diffusion en place est gardée, sinon la fin MS la remplace", () => {
  assert.deepEqual(
    computeMsLinkedPlanningDates({
      typeDoc: "COFFRAGE",
      msStart: "2026-09-21",
      msEnd: "2026-09-25",
      diffCoffrage: "2026-06-01",
      duree1: 1,
    }),
    { demarrage: "2026-09-21", diffCoffrage: "2026-06-01", dateLimite: "2026-05-25" }
  );
  assert.deepEqual(
    computeMsLinkedPlanningDates({
      typeDoc: "COFFRAGE",
      msStart: "2026-09-21",
      msEnd: "2026-09-25",
      duree1: 1,
    }),
    { demarrage: "2026-09-21", diffCoffrage: "2026-09-25", dateLimite: "2026-09-18" }
  );
});

test("coffrage sans durée 1 : la date limite en place est gardée, sinon le début MS la remplace", () => {
  assert.deepEqual(
    computeMsLinkedPlanningDates({
      typeDoc: "COFFRAGE",
      msStart: "2026-09-21",
      dateLimite: "2026-03-02",
      duree3: 1,
    }),
    { demarrage: "2026-09-21", diffCoffrage: "2026-09-14", dateLimite: "2026-03-02" }
  );
  assert.deepEqual(
    computeMsLinkedPlanningDates({ typeDoc: "COFFRAGE", msStart: "2026-09-21", duree3: 1 }),
    { demarrage: "2026-09-21", diffCoffrage: "2026-09-14", dateLimite: "2026-09-21" }
  );
});

test("armatures sans durées : les dates en place sont gardées, sinon la tâche MS les donne", () => {
  assert.deepEqual(
    computeMsLinkedPlanningDates({
      typeDoc: "ARMATURES",
      msStart: "2026-09-21",
      msEnd: "2026-09-25",
      diffArmature: "2026-07-06",
      diffCoffrage: "2026-06-01",
    }),
    { demarrage: "2026-09-21", diffArmature: "2026-07-06", diffCoffrage: "2026-06-01" }
  );
  assert.deepEqual(
    computeMsLinkedPlanningDates({ typeDoc: "ARMATURES", msStart: "2026-09-21", msEnd: "2026-09-25" }),
    { demarrage: "2026-09-21", diffArmature: "2026-09-25", diffCoffrage: "2026-09-21" }
  );
});

test("sans type de document : la barre prend les dates de la tâche MS", () => {
  assert.deepEqual(
    computeMsLinkedPlanningDates({ typeDoc: "", msStart: "2026-09-21", msEnd: "2026-09-25" }),
    { dateLimite: "2026-09-21", diffCoffrage: "2026-09-25" }
  );
});

// Le type se lit comme le dépôt dans Planning Projet l'a toujours lu : une note de calcul
// reste une note de calcul, même si son intitulé contient « armatures ».
test("une note de calcul d'armatures suit le calcul des notes de calcul, pas celui des armatures", () => {
  assert.deepEqual(
    computeMsLinkedPlanningDates({
      typeDoc: "Note de calcul armatures",
      msStart: "2026-09-21",
      msEnd: "2026-09-25",
      duree1: 2,
      duree2: 4,
      duree3: 3,
    }),
    { demarrage: "2026-09-21", diffCoffrage: "2026-08-31", dateLimite: "2026-08-17" }
  );
});

test("un type ni coffrage ni armatures pour le planning (« Armature » au singulier) suit la règle sans type", () => {
  assert.deepEqual(
    computeMsLinkedPlanningDates({
      typeDoc: "Armature",
      msStart: "2026-09-21",
      msEnd: "2026-09-25",
      duree2: 4,
      duree3: 3,
    }),
    { dateLimite: "2026-09-21", diffCoffrage: "2026-09-25" }
  );
});

test("sans début MS : le démarrage déjà enregistré sert de point de départ", () => {
  assert.deepEqual(
    computeMsLinkedPlanningDates({
      typeDoc: "COFFRAGE",
      demarrage: gristSeconds(2026, 9, 21),
      duree1: 2,
      duree3: 3,
    }),
    { demarrage: "2026-09-21", diffCoffrage: "2026-08-31", dateLimite: "2026-08-17" }
  );
  assert.deepEqual(computeMsLinkedPlanningDates({ typeDoc: "COFFRAGE", duree1: 2, duree3: 3 }), {});
});

test("une durée vide, négative ou non entière est ignorée ; une durée en texte est lue", () => {
  for (const duree3 of ["", null, undefined, -1, 1.5, "abc"]) {
    assert.deepEqual(
      computeMsLinkedPlanningDates({
        typeDoc: "COFFRAGE",
        msStart: "2026-09-21",
        diffCoffrage: "2026-06-01",
        dateLimite: "2026-05-01",
        duree3,
      }),
      { demarrage: "2026-09-21", diffCoffrage: "2026-06-01", dateLimite: "2026-05-01" },
      `durée 3 = ${JSON.stringify(duree3)}`
    );
  }
  assert.equal(
    computeMsLinkedPlanningDates({ typeDoc: "COFFRAGE", msStart: "2026-09-21", duree3: "2" }).diffCoffrage,
    "2026-09-07"
  );
});

test("les semaines sont calendaires : le changement d'heure ne décale pas le jour", () => {
  // 2026-03-29 : passage à l'heure d'été. 2026-04-06 − 2 semaines = 2026-03-23.
  assert.equal(
    computeMsLinkedPlanningDates({ typeDoc: "COFFRAGE", msStart: "2026-04-06", duree3: 2 }).diffCoffrage,
    "2026-03-23"
  );
  // 2026-10-25 : retour à l'heure d'hiver.
  assert.equal(
    computeMsLinkedPlanningDates({ typeDoc: "COFFRAGE", msStart: "2026-11-02", duree3: 2 }).diffCoffrage,
    "2026-10-19"
  );
});

const COLUMNS = {
  typeDoc: "Type_doc",
  dateLimite: "Date_limite",
  duree1: "Duree_1",
  diffCoffrage: "Diff_coffrage",
  duree2: "Duree_2",
  diffArmature: "Diff_armature",
  duree3: "Duree_3",
  demarragesTravaux: "Demarrages_travaux",
};

test("la ligne Grist est lue par ses colonnes et les dates rendues par nom de colonne", () => {
  const row = {
    id: 7,
    Type_doc: "NDC",
    Date_limite: gristSeconds(2026, 1, 5),
    Diff_coffrage: gristSeconds(2026, 1, 19),
    Duree_1: 2,
    Duree_3: 3,
  };

  assert.deepEqual(
    buildMsLinkedPlanningDateFields(row, COLUMNS, { msStart: "2026-09-21", msEnd: "2026-09-25" }),
    {
      Demarrages_travaux: "2026-09-21",
      Diff_coffrage: "2026-08-31",
      Date_limite: "2026-08-17",
    }
  );
});

test("les noms de colonnes ont des valeurs par défaut, celles de Planning_Projet", () => {
  assert.deepEqual(
    buildMsLinkedPlanningDateFields(
      { Type_doc: "ARMATURES", Duree_2: 1, Duree_3: 1 },
      {},
      { msStart: "2026-09-21" }
    ),
    {
      Demarrages_travaux: "2026-09-21",
      Diff_armature: "2026-09-14",
      Diff_coffrage: "2026-09-07",
    }
  );
});

test("seules les dates qui changent de jour sont gardées, quelle que soit leur écriture dans Grist", () => {
  const row = {
    Demarrages_travaux: gristSeconds(2026, 9, 21),
    Diff_coffrage: "2026-08-31",
    Date_limite: "10/08/2026",
  };

  assert.deepEqual(
    keepChangedPlanningDateFields(row, {
      Demarrages_travaux: "2026-09-21",
      Diff_coffrage: "2026-08-31",
      Date_limite: "2026-08-17",
    }),
    { Date_limite: "2026-08-17" }
  );
  assert.deepEqual(
    keepChangedPlanningDateFields(row, {
      Demarrages_travaux: "2026-09-21",
      Diff_coffrage: "2026-08-31",
    }),
    {}
  );
});
