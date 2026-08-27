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
