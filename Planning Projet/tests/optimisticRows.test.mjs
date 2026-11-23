// Affichage immédiat d'une écriture en cours : les lignes affichées prennent tout de suite
// les champs qui vont être écrits, et les rendent si l'écriture échoue.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { createOptimisticRows } from "../assets/js/services/optimisticRows.js";

function setup(initialRows, { pendingRender = () => null } = {}) {
  let rows = initialRows;
  let renders = 0;
  const optimistic = createOptimisticRows({
    getRows: () => rows,
    setRows: (next) => { rows = next; },
    render: () => { renders += 1; },
    idCol: "id",
    pendingRender,
  });
  return {
    optimistic,
    rows: () => rows,
    renders: () => renders,
    replaceRows: (next) => { rows = next; },
  };
}

const ROWS = Object.freeze([
  Object.freeze({ id: 1, Ligne_planning: "", Date_limite: "2026-07-01" }),
  Object.freeze({ id: 2, Ligne_planning: "7", Date_limite: "2026-07-08" }),
  Object.freeze({ id: 3, Ligne_planning: "", Date_limite: "2026-07-15" }),
]);

test("les lignes visées prennent leurs champs tout de suite, et le planning est redessiné une fois", () => {
  const view = setup(ROWS);

  view.optimistic.show(new Map([
    [1, { Ligne_planning: "42", Date_limite: "2026-08-17" }],
    [2, { Ligne_planning: null }],
  ]));

  assert.deepEqual(view.rows(), [
    { id: 1, Ligne_planning: "42", Date_limite: "2026-08-17" },
    { id: 2, Ligne_planning: null, Date_limite: "2026-07-08" },
    { id: 3, Ligne_planning: "", Date_limite: "2026-07-15" },
  ]);
  assert.equal(view.renders(), 1);
});

// Les lignes affichées alimentent des calculs mémorisés par identité : elles ne sont jamais
// modifiées en place (ROWS est gelé, une écriture en place lèverait une erreur).
test("ni le tableau ni les lignes d'origine ne sont modifiés ; une ligne non visée reste la même", () => {
  const view = setup(ROWS);

  view.optimistic.show(new Map([[1, { Ligne_planning: "42" }]]));

  assert.notEqual(view.rows(), ROWS);
  assert.equal(ROWS[0].Ligne_planning, "");
  assert.equal(view.rows()[2], ROWS[2]);
});

test("écriture refusée : les lignes d'avant reviennent et le planning est redessiné", () => {
  const view = setup(ROWS);

  const undo = view.optimistic.show(new Map([[1, { Ligne_planning: "42" }]]));
  undo();

  assert.equal(view.rows(), ROWS);
  assert.equal(view.renders(), 2);
});

// Entre l'affichage et l'échec, le planning a pu être relu dans Grist : ces lignes-là sont
// plus justes que la photo d'avant, elles ne doivent pas être écrasées.
test("le retour arrière ne touche pas des lignes relues entre-temps", () => {
  const view = setup(ROWS);
  const reloaded = [{ id: 1, Ligne_planning: "99", Date_limite: "2026-09-01" }];

  const undo = view.optimistic.show(new Map([[1, { Ligne_planning: "42" }]]));
  view.replaceRows(reloaded);
  undo();

  assert.equal(view.rows(), reloaded);
  assert.equal(view.renders(), 1);
});

// Un rechargement parti avant l'échec a pu lire les lignes anticipées : il les redessine
// en se terminant, APRÈS le retour arrière. L'écran montrerait alors un dépôt refusé.
test("un rechargement déjà en cours ne peut pas réafficher l'écriture refusée : redessin à sa fin", async () => {
  let finishReload;
  const reload = new Promise((resolve) => { finishReload = resolve; });
  const view = setup(ROWS, { pendingRender: () => reload });

  const undo = view.optimistic.show(new Map([[1, { Ligne_planning: "42" }]]));
  undo();
  assert.equal(view.renders(), 2, "affichage anticipé, puis retour arrière");

  finishReload();
  await reload;
  await null;

  assert.equal(view.renders(), 3, "redessiné depuis les lignes en place, une fois le rechargement fini");
  assert.equal(view.rows(), ROWS);
});

test("sans rechargement en cours, le retour arrière ne programme aucun redessin de plus", async () => {
  const view = setup(ROWS);

  view.optimistic.show(new Map([[1, { Ligne_planning: "42" }]]))();
  await null;
  await null;

  assert.equal(view.renders(), 2);
});

test("rien à afficher (lignes absentes, aucune ligne visée) : ni redessin ni retour arrière", () => {
  const withoutRows = setup(null);
  withoutRows.optimistic.show(new Map([[1, { Ligne_planning: "42" }]]))();
  assert.equal(withoutRows.rows(), null);
  assert.equal(withoutRows.renders(), 0);

  const withoutTarget = setup(ROWS);
  withoutTarget.optimistic.show(new Map([[99, { Ligne_planning: "42" }]]))();
  assert.equal(withoutTarget.rows(), ROWS);
  assert.equal(withoutTarget.renders(), 0);
});

test("le dépôt MS Project s'affiche avant son écriture et se retire si elle échoue", async () => {
  const source = await readFile(new URL("../assets/js/main.js", import.meta.url), "utf8");
  const start = source.indexOf("async function handleMsProjectRowDrop(");
  const handler = source.slice(start, source.indexOf("\nasync function ", start + 1));

  const shown = handler.indexOf("showMsProjectDropOptimistically(");
  const written = handler.indexOf("await updatePlanningFromMsProjectDrop(");
  assert.ok(shown > 0, "le dépôt doit être affiché tout de suite");
  assert.ok(shown < written, "l'affichage précède l'écriture");
  assert.match(
    handler,
    /catch \(error\) \{\s*undoOptimisticDrop\(\);/,
    "l'échec retire l'affichage anticipé"
  );
  assert.match(
    source,
    /function showMsProjectDropOptimistically\([^)]*\) \{[\s\S]*?planPlanningMsProjectDrop\(cachedPlanningRows,/,
    "l'affichage se calcule sur les lignes affichées, par la fonction que l'écriture utilise"
  );
  assert.match(
    source,
    /createOptimisticRows\(\{[\s\S]*?pendingRender: \(\) => refreshQueuePromise,/,
    "le retour arrière connaît le rechargement en cours"
  );
});
