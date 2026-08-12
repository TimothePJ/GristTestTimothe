import assert from "node:assert/strict";
import test from "node:test";

function emptyTable() {
  return { id: [] };
}

async function importFreshService(label) {
  const url = new URL("../assets/js/services/gristService.js", import.meta.url);
  url.searchParams.set("test", label);
  return import(url.href);
}

test("la creation du projet et de son budget est une transaction unique", async () => {
  const appliedTransactions = [];
  const previousWindow = globalThis.window;
  const previousServiceContext = globalThis.GristServiceContext;
  globalThis.GristServiceContext = { getService: () => "Structure" };
  globalThis.window = {
    grist: {
      docApi: {
        async fetchTable() { return emptyTable(); },
        async applyUserActions(actions) {
          appliedTransactions.push(actions);
          return { retValues: [52, 53, 54] };
        },
      },
    },
  };

  try {
    const service = await importFreshService("atomic-project-budget");
    await service.createProjectWithBudget({
      name: "Projet synchronise",
      projectNumber: "4242",
      budgetLines: [
        { chapter: "Etudes", amount: 1000 },
        { chapter: "Travaux", amount: 2000 },
      ],
    });

    assert.equal(appliedTransactions.length, 1);
    assert.deepEqual(
      appliedTransactions[0].map((action) => [action[0], action[1]]),
      [
        ["AddRecord", "Projets2"],
        ["AddRecord", "Budget"],
        ["AddRecord", "Budget"],
      ]
    );
  } finally {
    globalThis.window = previousWindow;
    globalThis.GristServiceContext = previousServiceContext;
  }
});

test("createTimeSegment rafraichit les alias de colonnes avant l'ecriture", async () => {
  let timeSegmentTable = {
    id: [1],
    NumeroProjet: ["1111"],
    Name: ["Abdelkarim Trabelsi"],
    Start_Date: [1785668400],
    End_Date: [1789034400],
    Allocation_Days: [28.5],
    Service: ["Structure"],
  };
  const fetchCalls = [];
  const appliedActions = [];
  const previousWindow = globalThis.window;

  globalThis.window = {
    grist: {
      docApi: {
        __serviceContextPatched: true,
        async fetchTable(tableName, options) {
          fetchCalls.push({ tableName, options });
          return tableName === "TimeSegment" ? timeSegmentTable : emptyTable();
        },
        async applyUserActions(actions) {
          appliedActions.push(...actions);
          return { retValues: [42] };
        },
      },
    },
  };

  try {
    const service = await importFreshService("fresh-time-segment-columns");
    await service.fetchProjectDataTables();

    timeSegmentTable = {
      ...timeSegmentTable,
      Start_At: timeSegmentTable.Start_Date,
      End_At: timeSegmentTable.End_Date,
    };
    delete timeSegmentTable.Start_Date;
    delete timeSegmentTable.End_Date;

    const createdId = await service.createTimeSegment({
      projectNumber: "1111",
      name: "Abdelkarim Trabelsi",
      startDate: new Date("2026-08-02T07:00:00.000Z"),
      endDate: new Date("2026-09-10T06:00:00.000Z"),
      allocationDays: 28.5,
    });

    assert.equal(createdId, 42);
    const fields = appliedActions.at(-1)[3];
    assert.equal(fields.Start_Date, undefined);
    assert.equal(fields.End_Date, undefined);
    assert.equal(fields.Start_At, Date.parse("2026-08-02T07:00:00.000Z") / 1000);
    assert.equal(fields.End_At, Date.parse("2026-09-10T06:00:00.000Z") / 1000);
    assert.equal(
      fetchCalls.some((call) =>
        call.tableName === "TimeSegment" && call.options?.forceRefresh === true
      ),
      true
    );
  } finally {
    globalThis.window = previousWindow;
  }
});

test("le repli de schema vide utilise Start_At et End_At", async () => {
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
      startDate: new Date("2026-08-02T07:00:00.000Z"),
      endDate: new Date("2026-09-10T06:00:00.000Z"),
      allocationDays: 28.5,
    });

    const fields = appliedActions.at(-1)[3];
    assert.equal(fields.Start_Date, undefined);
    assert.equal(fields.End_Date, undefined);
    assert.equal(fields.Start_At, Date.parse("2026-08-02T07:00:00.000Z") / 1000);
    assert.equal(fields.End_At, Date.parse("2026-09-10T06:00:00.000Z") / 1000);
  } finally {
    globalThis.window = previousWindow;
  }
});

test("la detection de schema inspecte toutes les lignes d'un tableau", async () => {
  const previousWindow = globalThis.window;
  globalThis.window = {
    grist: {
      docApi: {
        async fetchTable(tableName) {
          if (tableName !== "TimeSegment") return emptyTable();
          return [
            {
              id: 1,
              NumeroProjet: "1111",
              Name: "Premiere ligne",
              Start_Date: 1785668400,
              Allocation_Days: 1,
              Service: "Structure",
            },
            {
              id: 2,
              NumeroProjet: "1111",
              Name: "Deuxieme ligne",
              Start_Date: 1785754800,
              EndDate: 1785841200,
              Allocation_Days: 1,
              Service: "Structure",
            },
          ];
        },
        async applyUserActions() {
          throw new Error("Aucune ecriture attendue dans ce test.");
        },
      },
    },
  };

  try {
    const service = await importFreshService("all-row-column-detection");
    const data = await service.fetchProjectDataTables();
    assert.equal(data.timeSegmentRows[1].End_At, 1785841200);
  } finally {
    globalThis.window = previousWindow;
  }
});
