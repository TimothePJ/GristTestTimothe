import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { normalizeFetchTableResult, resolveColumnId } from "../assets/js/services/gristService.js";

// Le VRAI noyau de la couche de contexte partagee (module CommonJS charge par
// index.html avant le widget). C'est lui qui porte la garde d'ecriture, la
// validation ligne a ligne et la reecriture d'actions que subit tout lot envoye
// a `grist.docApi.applyUserActions` en production.
//
// Le charger POSE `globalThis.GristServiceContextCore` (le module s'installe sur
// la racine, c'est son mode d'emploi navigateur). On restaure aussitot l'etat
// d'avant : `getActiveService()` de gristService.js teste ce global, et sa
// presence detourne les autres tests de ce fichier vers une branche de repli qui
// lit `localStorage` — indisponible sous Node.
const previousServiceContextCore = globalThis.GristServiceContextCore;
const serviceContextCore = createRequire(import.meta.url)("../../shared/service-context-core.js");
if (previousServiceContextCore === undefined) {
  delete globalThis.GristServiceContextCore;
} else {
  globalThis.GristServiceContextCore = previousServiceContextCore;
}

test("normalizeFetchTableResult converts column-oriented to rows", () => {
  const rows = normalizeFetchTableResult({ id: [1, 2], Name: ["A", "B"] });
  assert.deepEqual(rows, [{ id: 1, Name: "A" }, { id: 2, Name: "B" }]);
});

test("resolveColumnId matches alias Start_At", () => {
  assert.equal(resolveColumnId(["id", "Start_At"], "Start_Date", ["Start_At"]), "Start_At");
});

// Le reste de ce fichier exerce le chemin Grist (createTimeSegment,
// updateTimeSegment, fetchProjectData), qui touche `window.grist` et met les
// colonnes resolues en cache au niveau du module : chaque test reimporte le
// service sous une URL suffixee (comme gestion-depenses2/tests/gristService.test.mjs)
// pour repartir d'un cache neuf et ne pas polluer les autres tests.
async function importFreshService(label) {
  const url = new URL("../assets/js/services/gristService.js", import.meta.url);
  url.searchParams.set("test", label);
  return import(url.href);
}

function emptyTable() {
  return { id: [] };
}

test("createTimeSegment ecrit Mois et Allocation_Days, plus de Start_At/End_At", async () => {
  const appliedActions = [];
  const previousWindow = globalThis.window;
  globalThis.window = {
    grist: {
      docApi: {
        async fetchTable() {
          return {
            id: [],
            NumeroProjet: [],
            Name: [],
            Mois: [],
            Allocation_Days: [],
            Effectif: [],
            Label: [],
            Service: [],
          };
        },
        async applyUserActions(actions) {
          appliedActions.push(...actions);
          return { retValues: [42] };
        },
      },
    },
  };

  try {
    const service = await importFreshService("create-time-segment-mois");
    await service.createTimeSegment({
      projectNumber: "25-0142",
      name: "Marie DUPONT",
      monthKey: "2026-09",
      effectif: 8,
    });

    const fields = appliedActions.at(-1)[3];
    assert.equal(fields.Mois, Math.floor(new Date(2026, 8, 1).getTime() / 1000));
    assert.equal(fields.Effectif, 8);
    assert.equal(fields.Allocation_Days, 22); // septembre 2026 = 22 jours ouvres
    assert.ok(!("Start_At" in fields), "Start_At ne doit plus etre ecrite");
    assert.ok(!("End_At" in fields), "End_At ne doit plus etre ecrite");
  } finally {
    globalThis.window = previousWindow;
  }
});

test("le repli de schema vide utilise Mois et Allocation_Days", async () => {
  const appliedActions = [];
  const previousWindow = globalThis.window;
  globalThis.window = {
    grist: {
      docApi: {
        async fetchTable() {
          return emptyTable();
        },
        async applyUserActions(actions) {
          appliedActions.push(...actions);
          return { retValues: [43] };
        },
      },
    },
  };

  try {
    const service = await importFreshService("empty-schema-fallback");
    await service.createTimeSegment({
      projectNumber: "1111",
      name: "Abdelkarim Trabelsi",
      monthKey: "2026-09",
      effectif: 5,
    });

    const fields = appliedActions.at(-1)[3];
    assert.equal(fields.Mois, Math.floor(new Date(2026, 8, 1).getTime() / 1000));
    assert.equal(fields.Allocation_Days, 22);
    assert.ok(!("Start_At" in fields));
    assert.ok(!("End_At" in fields));
  } finally {
    globalThis.window = previousWindow;
  }
});

test("updateTimeSegment ecrit Mois et Allocation_Days derives, plus de Start_At/End_At", async () => {
  const appliedActions = [];
  const previousWindow = globalThis.window;
  globalThis.window = {
    grist: {
      docApi: {
        async fetchTable() {
          return emptyTable();
        },
        async applyUserActions(actions) {
          appliedActions.push(...actions);
          return { retValues: [] };
        },
      },
    },
  };

  try {
    const service = await importFreshService("update-time-segment-mois");
    await service.updateTimeSegment({
      segmentId: 7,
      monthKey: "2026-09",
      effectif: 12,
    });

    const [action, tableName, id, fields] = appliedActions.at(-1);
    assert.equal(action, "UpdateRecord");
    assert.equal(tableName, "TimeSegment");
    assert.equal(id, 7);
    assert.equal(fields.Mois, Math.floor(new Date(2026, 8, 1).getTime() / 1000));
    assert.equal(fields.Allocation_Days, 22);
    assert.equal(fields.Effectif, 12);
    assert.ok(!("Start_At" in fields), "Start_At ne doit plus etre ecrite");
    assert.ok(!("End_At" in fields), "End_At ne doit plus etre ecrite");
  } finally {
    globalThis.window = previousWindow;
  }
});

// Preuve directe demandee par la consigne (point 3) : contrairement a
// gestion-depenses2 AVANT sa Task 3, fetchProjectData() de planning-synchro ne
// reconstruit PAS chaque ligne via une liste blanche de colonnes codee en dur
// (il renvoie les lignes brutes de fetchTableRows, filtrees par projet) : la
// colonne Mois doit donc deja traverser intacte, meme sans aucun correctif.
test("fetchProjectData conserve Mois pour un segment (pas de liste blanche qui la perdrait)", async () => {
  const moisValue = Math.floor(new Date(2026, 8, 1).getTime() / 1000);
  const previousWindow = globalThis.window;
  globalThis.window = {
    grist: {
      docApi: {
        async fetchTable(tableName) {
          if (tableName !== "TimeSegment") return emptyTable();
          return {
            id: [9],
            NumeroProjet: ["1111"],
            Name: ["Alix Martin"],
            Mois: [moisValue],
            Allocation_Days: [22],
            Effectif: [10],
            Service: ["Structure"],
          };
        },
      },
    },
  };

  try {
    const service = await importFreshService("fetch-project-data-preserves-mois");
    const data = await service.fetchProjectData({ name: "Peu importe", number: "1111" });
    assert.equal(data.timeSegmentRows.length, 1);
    assert.equal(data.timeSegmentRows[0].Mois, moisValue);
    assert.equal(data.timeSegmentRows[0].Start_At, undefined);
  } finally {
    globalThis.window = previousWindow;
  }
});

// La barre de charge mensuelle de la fenetre segment raisonne sur la PERSONNE,
// pas sur le projet affiche : elle a besoin de TOUTES les lignes TimeSegment.
//
// PIEGE, ET LE BUG QUI EN EST SORTI : `grist.docApi.fetchTable` est PATCHE par
// shared/grist-service-context.js, et TimeSegment y a une politique
// REST_PROJECT_SERVICE (shared/service-context-core.js). Une lecture ordinaire
// est donc deja filtree par projet ET par service AVANT que ce service ne voie
// la moindre ligne : ce que le widget appelait allTimeSegmentRows ne contenait
// en realite que le projet affiche. La sortie prevue par le contrat est
// l option { fullTable: true } (verifiee sur le vrai module partage dans
// shared/tests/service-context-runtime.test.cjs).
//
// Le bouchon ci-dessous IMITE ce contrat, filtre compris — un bouchon qui rend
// tout a tout le monde, comme le precedent, ne pouvait pas voir le bug.
function contextPatchedDocApi(rows, { project = "1111", service = "Structure", patched = true } = {}) {
  const columnar = (list) => ({
    id: list.map((row) => row.id),
    NumeroProjet: list.map((row) => row.NumeroProjet),
    Name: list.map((row) => row.Name),
    Effectif: list.map((row) => row.Effectif),
    Service: list.map((row) => row.Service),
  });
  const calls = [];
  const docApi = {
    async fetchTable(tableName, options) {
      calls.push({ tableName, options });
      if (tableName !== "TimeSegment") return emptyTable();
      if (options && options.fullTable === true) return columnar(rows);
      return columnar(rows.filter((row) => (
        row.NumeroProjet === project && row.Service === service
      )));
    },
  };
  if (patched) docApi.__serviceContextPatched = true;
  return { docApi, calls };
}

const CROSS_PROJECT_ROWS = [
  { id: 1, NumeroProjet: "1111", Name: "Alix Martin", Effectif: 4, Service: "Structure" },
  { id: 2, NumeroProjet: "2222", Name: "Alix Martin", Effectif: 5, Service: "Fluides" },
  { id: 3, NumeroProjet: "1111", Name: "Paul Durand", Effectif: 6, Service: "Structure" },
];

test("fetchProjectData expose allTimeSegmentRows : tous projets, tous services", async () => {
  const previousWindow = globalThis.window;
  const { docApi, calls } = contextPatchedDocApi(CROSS_PROJECT_ROWS);
  globalThis.window = { grist: { docApi } };

  try {
    const service = await importFreshService("fetch-project-data-all-rows");
    const data = await service.fetchProjectData({ name: "Peu importe", number: "1111" });

    assert.deepEqual(
      data.timeSegmentRows.map((row) => row.id),
      [1, 3],
      "la vue projet reste filtree projet + service (non-regression)"
    );
    assert.deepEqual(
      data.allTimeSegmentRows.map((row) => row.id).sort(),
      [1, 2, 3],
      "la barre doit voir la ligne du projet 2222, service Fluides"
    );
    assert.ok(
      data.allTimeSegmentRows.some((row) => row.NumeroProjet === "2222"),
      "sans elle la barre montrerait une disponibilite qui n existe pas"
    );
    assert.ok(
      calls.some((call) => call.tableName === "TimeSegment" && call.options && call.options.fullTable === true),
      "la lecture non filtree doit bien etre demandee au contrat partage"
    );
  } finally {
    globalThis.window = previousWindow;
  }
});

test("fetchProjectData ne relit TimeSegment que deux fois : la vue projet et la barre", async () => {
  // Le cout compte : la relecture en place (reloadChargeFromGrist) repasse par
  // fetchProjectData a chaque signal.
  const previousWindow = globalThis.window;
  const { docApi, calls } = contextPatchedDocApi(CROSS_PROJECT_ROWS);
  globalThis.window = { grist: { docApi } };

  try {
    const service = await importFreshService("fetch-project-data-cost");
    await service.fetchProjectData({ name: "Peu importe", number: "1111" });
    assert.equal(
      calls.filter((call) => call.tableName === "TimeSegment").length,
      2,
      "une lecture filtree pour le pane bas, une lecture complete pour la barre"
    );
  } finally {
    globalThis.window = previousWindow;
  }
});

test("hors couche de contexte, fetchProjectData n envoie aucune option a Grist", async () => {
  // dev/harness.html et le RPC Grist natif n acceptent qu un nom de table : leur
  // passer un second argument serait au mieux ignore, au pire une erreur. La barre
  // retombe alors sur les lignes deja lues.
  const previousWindow = globalThis.window;
  const { docApi, calls } = contextPatchedDocApi(CROSS_PROJECT_ROWS, { patched: false });
  globalThis.window = { grist: { docApi } };

  try {
    const service = await importFreshService("fetch-project-data-unpatched");
    const data = await service.fetchProjectData({ name: "Peu importe", number: "1111" });
    assert.ok(
      calls.filter((call) => call.tableName === "TimeSegment").every((call) => call.options === undefined),
      "aucune option ne doit atteindre un fetchTable non patche"
    );
    assert.ok(Array.isArray(data.allTimeSegmentRows), "la barre garde un tableau exploitable");
  } finally {
    globalThis.window = previousWindow;
  }
});

// updatePlanningDurations (Tache 5) : ecriture des trois colonnes de duree
// (Duree_Projet / Duree_Zone / Duree_Force) sur Planning_Projet, a partir des
// `writes` collectes par bottom/chargeAssignModal.js::collectChargeWrites.

test("updatePlanningDurations ecrit toutes les lignes en UN SEUL lot", async () => {
  // Assigner Duree_Projet au COFFRAGE d'un projet reel touche 112 lignes : un
  // lot par ligne declencherait 112 rafraichissements via le relais de
  // synchronisation inter-widgets. Un seul appel, quel que soit le nombre de
  // lignes.
  const calls = [];
  const previousWindow = globalThis.window;
  globalThis.window = {
    grist: {
      docApi: {
        async applyUserActions(actions) {
          calls.push(actions);
          return { retValues: actions.map(() => null) };
        },
      },
    },
  };

  try {
    const service = await importFreshService("update-planning-durations-batch");
    await service.updatePlanningDurations([
      { recordId: 101, fields: { Duree_Projet: 5 } },
      { recordId: 102, fields: { Duree_Projet: 5 } },
      { recordId: 103, fields: { Duree_Zone: 3 } },
    ]);

    assert.equal(calls.length, 1, "un seul appel a applyUserActions, quel que soit le nombre de lignes");
    assert.equal(calls[0].length, 3);
    assert.deepEqual(calls[0][0], ["UpdateRecord", "Planning_Projet", 101, { Duree_Projet: 5 }]);
    assert.deepEqual(calls[0][1], ["UpdateRecord", "Planning_Projet", 102, { Duree_Projet: 5 }]);
    assert.deepEqual(calls[0][2], ["UpdateRecord", "Planning_Projet", 103, { Duree_Zone: 3 }]);
  } finally {
    globalThis.window = previousWindow;
  }
});

// Ce que la COUCHE DE CONTEXTE PARTAGEE fait du lot, avec ses VRAIES fonctions.
//
// En production, `applyActions` n'appelle pas Grist directement : il appelle
// `grist.docApi.applyUserActions`, que shared/grist-service-context.js a patche.
// Ce patch (serviceAwareApplyUserActions) enchaine, dans cet ordre :
//   1. garde d'ecriture  : `core.isProtectedMutationAction` sur chaque action ;
//   2. validation cible  : chaque ligne mutee doit passer `core.rowMatchesContext`
//      (Service de la ligne == service courant, et NomProjet parmi les noms du
//      projet selectionne pour Planning_Projet) ;
//   3. reecriture        : `core.transformActions` complete les champs.
// Les quatre tests d'updatePlanningDurations ci-dessus bouchonnent
// `applyUserActions` et court-circuitent donc TOUTE cette couche : un refus ne
// se verrait qu'a l'enregistrement, en production. Planning_Projet etant la
// premiere table hors TimeSegment que ce widget ecrit, la fonction ci-dessous
// rejoue le patch reel — pas une imitation de sa logique, les trois etapes
// appellent les vraies fonctions du module partage.
function contextPatchedApplyUserActions({
  rows,
  selectedService = "Structure",
  project = { number: "25-0142", name: "ERA QUAI D'ORSAY", names: ["ERA QUAI D'ORSAY"] },
}) {
  const core = serviceContextCore;
  const rowsById = new Map(rows.map((row) => [Number(row.id), row]));
  const appliedBatches = [];

  return {
    appliedBatches,
    applyUserActions: async (actions) => {
      // 1. la table est-elle protegee ? (sinon rien de ce qui suit ne s'applique
      //    et ce test ne prouverait rien)
      assert.ok(
        actions.every((action) => core.isProtectedMutationAction(action)),
        "Planning_Projet doit etre une table protegee, sinon la validation ne joue pas"
      );

      // 2. validation ligne a ligne (validateProtectedMutationTargets)
      actions.forEach((action) => {
        const tableName = action[1];
        core.getMutationRecordIds(action).forEach((recordId) => {
          const row = rowsById.get(recordId);
          if (!row || !core.rowMatchesContext(row, tableName, {
            selectedService,
            projectNumber: project.number,
            projectName: project.name,
            projectNames: project.names || [],
          })) {
            throw new Error(
              `La ligne ${recordId} de ${tableName} n'appartient pas au projet et au service selectionnes.`
            );
          }
        });
      });

      // 3. reecriture des champs
      const transformed = core.transformActions(actions, {
        selectedService,
        projectNumber: project.number,
        projectName: project.name,
      });
      appliedBatches.push(transformed);
      return { retValues: transformed.map(() => null) };
    },
  };
}

const PLANNING_ROWS_IN_DOC = [
  { id: 101, Service: "Structure", NomProjet: "ERA QUAI D'ORSAY", Duree_Projet: "" },
  { id: 102, Service: "Structure", NomProjet: "ERA QUAI D'ORSAY", Duree_Projet: "" },
];

test("updatePlanningDurations : le lot traverse la couche de contexte partagee", async () => {
  const layer = contextPatchedApplyUserActions({ rows: PLANNING_ROWS_IN_DOC });
  const previousWindow = globalThis.window;
  globalThis.window = {
    // Le widget ne parle jamais a cette couche directement : elle se manifeste
    // par le patch de `applyUserActions`. Le contexte est neanmoins installe
    // comme en production (getService/getCurrentProject sont lus ailleurs dans
    // le service).
    GristServiceContext: {
      getService: () => "Structure",
      getCurrentProject: () => ({ id: 1, number: "25-0142", name: "ERA QUAI D'ORSAY" }),
    },
    grist: {
      docApi: {
        __serviceContextPatched: true,
        applyUserActions: layer.applyUserActions,
      },
    },
  };

  try {
    const service = await importFreshService("update-planning-durations-context-layer");
    await service.updatePlanningDurations([
      { recordId: 101, fields: { Duree_Projet: 5 } },
      { recordId: 102, fields: { Duree_Projet: 5, Duree_Zone: "" } },
    ]);

    assert.equal(layer.appliedBatches.length, 1, "un seul lot atteint Grist");
    const [batch] = layer.appliedBatches;
    assert.equal(batch.length, 2);

    // Les durees survivent telles quelles — y compris le "" d'un niveau efface,
    // qui est une valeur significative de la cascade (jamais 0).
    assert.equal(batch[0][3].Duree_Projet, 5);
    assert.equal(batch[1][3].Duree_Projet, 5);
    assert.equal(batch[1][3].Duree_Zone, "");
    assert.deepEqual(batch.map((action) => [action[0], action[1], action[2]]), [
      ["UpdateRecord", "Planning_Projet", 101],
      ["UpdateRecord", "Planning_Projet", 102],
    ]);

    // Ce que la couche AJOUTE au passage : Planning_Projet est service-aware et
    // porte un NomProjet, donc chaque UpdateRecord repart complete. Ce n'est pas
    // un no-op — on le fige ici pour qu'une evolution du contrat partage se voie
    // dans cette suite plutot qu'en production.
    assert.equal(batch[0][3].Service, "Structure");
    assert.equal(batch[0][3].NomProjet, "ERA QUAI D'ORSAY");
  } finally {
    globalThis.window = previousWindow;
  }
});

test("updatePlanningDurations : la couche de contexte REFUSE une ligne d'un autre service", async () => {
  // Contrepartie indispensable : sans elle, le test precedent passerait meme si
  // la validation ne regardait rien. Le refus vient de la VRAIE
  // `core.rowMatchesContext`, pas d'une regle reecrite ici.
  const layer = contextPatchedApplyUserActions({
    rows: [
      { id: 101, Service: "Structure", NomProjet: "ERA QUAI D'ORSAY", Duree_Projet: "" },
      { id: 999, Service: "Synthese", NomProjet: "ERA QUAI D'ORSAY", Duree_Projet: "" },
    ],
  });
  const previousWindow = globalThis.window;
  globalThis.window = {
    GristServiceContext: { getService: () => "Structure" },
    grist: { docApi: { __serviceContextPatched: true, applyUserActions: layer.applyUserActions } },
  };

  try {
    const service = await importFreshService("update-planning-durations-context-refus");
    await assert.rejects(
      () => service.updatePlanningDurations([
        { recordId: 101, fields: { Duree_Projet: 5 } },
        { recordId: 999, fields: { Duree_Projet: 5 } },
      ]),
      /n'appartient pas au projet et au service/
    );
    assert.equal(layer.appliedBatches.length, 0, "le refus tombe AVANT toute ecriture");
  } finally {
    globalThis.window = previousWindow;
  }
});

test("updatePlanningDurations ne fait rien sans ecriture", async () => {
  let called = false;
  const previousWindow = globalThis.window;
  globalThis.window = {
    grist: {
      docApi: {
        async applyUserActions() {
          called = true;
          return { retValues: [] };
        },
      },
    },
  };

  try {
    const service = await importFreshService("update-planning-durations-empty");
    await service.updatePlanningDurations([]);
    // CE QUE CE TEST EPINGLE EXACTEMENT : le CONTRAT « un lot vide ne part
    // jamais chez Grist », pas la garde `if (!actions.length) return` d'
    // updatePlanningDurations. `applyActions` refuse deja un tableau vide de son
    // cote : supprimer la garde locale laisserait ce test au vert. Ce qui est
    // fixe ici, c'est donc la propriete observable, quel que soit celui des deux
    // etages qui la tient.
    assert.equal(called, false, "applyUserActions ne doit jamais etre appele sur un tableau vide");
  } finally {
    globalThis.window = previousWindow;
  }
});

test("updatePlanningDurations rejette un recordId invalide, sans ecriture partielle", async () => {
  let called = false;
  const previousWindow = globalThis.window;
  globalThis.window = {
    grist: {
      docApi: {
        async applyUserActions() {
          called = true;
          return { retValues: [] };
        },
      },
    },
  };

  try {
    const service = await importFreshService("update-planning-durations-invalid-id");
    await assert.rejects(() =>
      service.updatePlanningDurations([
        { recordId: 101, fields: { Duree_Projet: 5 } },
        { recordId: "not-an-id", fields: { Duree_Zone: 3 } },
      ])
    );
    assert.equal(called, false, "aucune ecriture ne doit partir si un id est invalide, meme partiellement");
  } finally {
    globalThis.window = previousWindow;
  }
});

test("updatePlanningDurations fusionne plusieurs entrees pour la MEME ligne en un seul UpdateRecord", async () => {
  // Cf. brief Tache 5 point (B) : l'utilisateur peut editer le type, la zone
  // ET le document d'une meme ligne dans la meme session -> collectChargeWrites
  // emet alors PLUSIEURS entrees {recordId, fields} pour le meme recordId,
  // chacune portant une colonne differente (Duree_Projet / Duree_Zone /
  // Duree_Force). Decision : fusionner par recordId plutot que de compter sur
  // l'ORDRE d'application de plusieurs UpdateRecord visant la meme ligne dans
  // un seul lot (rien ne garantit cet ordre cote Grist) - ce test le fixe.
  const calls = [];
  const previousWindow = globalThis.window;
  globalThis.window = {
    grist: {
      docApi: {
        async applyUserActions(actions) {
          calls.push(actions);
          return { retValues: actions.map(() => null) };
        },
      },
    },
  };

  try {
    const service = await importFreshService("update-planning-durations-duplicate-record");
    await service.updatePlanningDurations([
      { recordId: 101, fields: { Duree_Projet: 5 } },
      { recordId: 101, fields: { Duree_Zone: 3 } },
      { recordId: 101, fields: { Duree_Force: 1.5 } },
    ]);

    assert.equal(calls.length, 1);
    assert.equal(calls[0].length, 1, "une seule UpdateRecord pour la ligne 101, pas trois");
    assert.deepEqual(calls[0][0], [
      "UpdateRecord",
      "Planning_Projet",
      101,
      { Duree_Projet: 5, Duree_Zone: 3, Duree_Force: 1.5 },
    ]);
  } finally {
    globalThis.window = previousWindow;
  }
});
