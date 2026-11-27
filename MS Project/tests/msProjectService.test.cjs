// Arborescence du planning : sections dépliables et lignes masquées par une section repliée.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const serviceUrl = pathToFileURL(
  path.join(__dirname, "..", "assets", "js", "services", "msProjectService.js")
).href;

const PLANNING = "Planning A";

// Une ligne de la table MsProject, telle que l'import l'écrit. `level` vide = planning importé
// avant que le niveau soit enregistré.
function taskRow(uniqueNumber, name, level, overrides = {}) {
  return {
    id: 100 + Number(uniqueNumber),
    Numero_Unique: String(uniqueNumber),
    Nom_Tache: name,
    Nom: PLANNING,
    Debut: "2026-03-02",
    Fin: "2026-03-13",
    Duree: 10,
    Niveau: level,
    Bold: "",
    Style_Barre: "GO_Structure BA",
    ...overrides,
  };
}

// L'ordre du fichier XML est porté par Indicateur (rang dans le fichier + 1).
function inFileOrder(rows) {
  return rows.map((row, index) => ({ Indicateur: index + 2, ...row }));
}

// A            (1)
//   A1         (2)
//     A1a      (3)
//   A2         (2)
// B            (1)
function outlinedRows() {
  return inFileOrder([
    taskRow(1, "A", "1", { Bold: "Oui" }),
    taskRow(2, "A1", "2", { Bold: "Oui" }),
    taskRow(3, "A1a", "3"),
    taskRow(4, "A2", "2"),
    taskRow(5, "B", "1"),
  ]);
}

async function build(rows, { sortMode = "xml-order", collapsedIds } = {}) {
  const { buildTimelineDataFromMsProjectRows } = await import(serviceUrl);
  return buildTimelineDataFromMsProjectRows(rows, PLANNING, sortMode, { collapsedIds });
}

const names = (data) => data.groups.map((group) => group.taskLabel);
const groupNamed = (data, name) => data.groups.find((group) => group.taskLabel === name);

test("un planning sans niveau s'affiche à plat, sans section dépliable", async () => {
  const rows = inFileOrder([
    taskRow(1, "A", "", { Bold: "Oui" }),
    taskRow(2, "A1", ""),
    taskRow(3, "B", ""),
  ]);

  const data = await build(rows, { collapsedIds: ["1"] });

  assert.equal(data.hasOutline, false);
  assert.deepEqual(names(data), ["A", "A1", "B"]);
  assert.deepEqual(data.groups.map((group) => group.outlineDepth), [null, null, null]);
  assert.deepEqual(data.groups.map((group) => group.isExpandable), [false, false, false]);
});

test("avec des niveaux, chaque ligne connaît sa profondeur et les sections sont dépliables", async () => {
  const data = await build(outlinedRows());

  assert.equal(data.hasOutline, true);
  assert.deepEqual(names(data), ["A", "A1", "A1a", "A2", "B"]);
  assert.deepEqual(data.groups.map((group) => group.outlineDepth), [0, 1, 2, 1, 0]);
  assert.deepEqual(
    data.groups.map((group) => group.isExpandable),
    [true, true, false, false, false]
  );
  assert.deepEqual(
    data.groups.map((group) => group.isCollapsed),
    [false, false, false, false, false]
  );
});

test("une section repliée masque ce qu'elle contient, pas la suite du planning", async () => {
  const data = await build(outlinedRows(), { collapsedIds: ["2"] });

  assert.deepEqual(names(data), ["A", "A1", "A2", "B"]);
  assert.equal(groupNamed(data, "A1").isCollapsed, true);
  assert.equal(groupNamed(data, "A").isCollapsed, false);
  assert.equal(data.rowCount, 4);
});

test("les barres des lignes masquées ne sont pas dessinées", async () => {
  const data = await build(outlinedRows(), { collapsedIds: ["1"] });
  const shownGroupIds = new Set(data.groups.map((group) => group.id));

  assert.deepEqual(names(data), ["A", "B"]);
  assert.equal(data.items.length, 2);
  assert.ok(data.items.every((item) => shownGroupIds.has(item.group)));
});

test("une sous-section garde son état quand la section qui la contient est repliée puis dépliée", async () => {
  const folded = await build(outlinedRows(), { collapsedIds: ["1", "2"] });
  const unfolded = await build(outlinedRows(), { collapsedIds: ["2"] });

  assert.deepEqual(names(folded), ["A", "B"]);
  assert.deepEqual(names(unfolded), ["A", "A1", "A2", "B"]);
});

test("le numéro d'une tâche sans sous-tâche ne replie rien", async () => {
  const data = await build(outlinedRows(), { collapsedIds: ["4"] });

  assert.deepEqual(names(data), ["A", "A1", "A1a", "A2", "B"]);
  assert.equal(groupNamed(data, "A2").isCollapsed, false);
});

test("replier une section ne modifie pas les lignes qui restent affichées", async () => {
  const open = await build(outlinedRows());
  const folded = await build(outlinedRows(), { collapsedIds: ["2"] });

  // vis-timeline ne redessine que les lignes dont l'enregistrement change.
  for (const name of ["A", "A2", "B"]) {
    assert.deepEqual(groupNamed(folded, name), groupNamed(open, name), name);
  }
});

test("hors du tri par défaut, la liste reste à plat et complète", async () => {
  for (const sortMode of ["chronological", "planning-number"]) {
    const data = await build(outlinedRows(), { sortMode, collapsedIds: ["1"] });

    assert.equal(data.hasOutline, false, sortMode);
    assert.equal(data.groups.length, 5, sortMode);
    assert.ok(data.groups.every((group) => group.outlineDepth === null), sortMode);
    assert.ok(data.groups.every((group) => !group.isExpandable), sortMode);
  }
});

test("une ligne sans niveau reste dans la section de la ligne qui la précède", async () => {
  const rows = inFileOrder([
    taskRow(1, "A", "1"),
    taskRow(2, "A1", "2"),
    taskRow(3, "Ajoutée à la main", ""),
    taskRow(4, "B", "1"),
  ]);

  const open = await build(rows);
  const folded = await build(rows, { collapsedIds: ["1"] });

  assert.deepEqual(open.groups.map((group) => group.outlineDepth), [0, 1, 1, 0]);
  assert.deepEqual(names(folded), ["A", "B"]);
});
