import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeFetchTableResult, resolveColumnId } from "../assets/js/services/gristService.js";

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
