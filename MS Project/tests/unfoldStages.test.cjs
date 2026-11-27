// Dépli d'une grosse section en deux temps : d'abord les lignes qui tiennent à l'écran,
// puis le reste une fois ces premières lignes affichées. Ajouter une ligne au planning a un
// coût fixe, et plusieurs centaines d'un coup figent la page près d'une seconde.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const moduleUrl = pathToFileURL(
  path.join(__dirname, "..", "assets", "js", "unfoldStages.js")
).href;

const load = () => import(moduleUrl);

// Planning de `count` lignes numérotées 1..count, une barre par ligne (sauf `withoutBar`).
function planning(count, { withoutBar = [] } = {}) {
  const groups = [];
  const items = [];
  for (let number = 1; number <= count; number += 1) {
    groups.push({ id: `ms-${number}`, sortIndex: number - 1, taskLabel: `Ligne ${number}` });
    if (!withoutBar.includes(number)) {
      items.push({ id: `ms-${number}-task`, group: `ms-${number}` });
    }
  }
  return { groups, items, rowCount: count, hasOutline: true };
}

const idsOf = (numbers) => new Set(numbers.map((number) => `ms-${number}`));
const range = (from, to) => Array.from({ length: to - from + 1 }, (_, index) => from + index);
const numbersOf = (records, key = "id") => records.map((record) => Number(record[key].split("-")[1]));

test("un petit dépli se fait d'un coup", async () => {
  const { planFirstUnfoldStage } = await load();
  // 10 lignes affichées, la section en ajoute 5.
  const displayed = idsOf([...range(1, 5), ...range(11, 15)]);

  assert.equal(planFirstUnfoldStage(planning(15), displayed, { threshold: 5, firstRows: 3 }), null);
});

test("un gros dépli affiche d'abord les premières lignes de la section", async () => {
  const { planFirstUnfoldStage } = await load();
  // Lignes 1 à 3 affichées, puis la section déplie 4 à 13, puis 14 à 16 déjà affichées.
  const displayed = idsOf([1, 2, 3, 14, 15, 16]);

  const first = planFirstUnfoldStage(planning(16), displayed, { threshold: 5, firstRows: 4 });

  assert.deepEqual(numbersOf(first.groups), [1, 2, 3, 4, 5, 6, 7, 14, 15, 16]);
});

test("les barres des lignes remises à plus tard attendent avec elles", async () => {
  const { planFirstUnfoldStage } = await load();
  const displayed = idsOf([1, 2, 3, 14, 15, 16]);

  const first = planFirstUnfoldStage(planning(16, { withoutBar: [5] }), displayed, {
    threshold: 5,
    firstRows: 4,
  });

  assert.deepEqual(numbersOf(first.items, "group"), [1, 2, 3, 4, 6, 7, 14, 15, 16]);
});

test("le premier temps garde chaque ligne telle quelle, à son rang", async () => {
  const { planFirstUnfoldStage } = await load();
  const full = planning(16);
  const snapshot = JSON.stringify(full);

  const first = planFirstUnfoldStage(full, idsOf([1, 2, 3, 14, 15, 16]), { threshold: 5, firstRows: 4 });

  // Mêmes objets que dans le planning complet : rien n'est recopié ni renuméroté.
  first.groups.forEach((group) => assert.equal(group, full.groups[group.sortIndex]));
  assert.equal(first.hasOutline, true);
  // Le planning complet, lui, n'est pas modifié : il sert au second temps.
  assert.equal(JSON.stringify(full), snapshot);
});

test("le seuil se joue à une ligne près", async () => {
  const { planFirstUnfoldStage } = await load();
  const displayed = idsOf([1]);

  // 5 lignes nouvelles : pas plus que le seuil.
  assert.equal(planFirstUnfoldStage(planning(6), displayed, { threshold: 5, firstRows: 2 }), null);
  // 6 lignes nouvelles : en deux temps.
  const first = planFirstUnfoldStage(planning(7), displayed, { threshold: 5, firstRows: 2 });
  assert.deepEqual(numbersOf(first.groups), [1, 2, 3]);
});

test("replier une section ne se fait jamais en deux temps", async () => {
  const { planFirstUnfoldStage } = await load();

  assert.equal(planFirstUnfoldStage(planning(3), idsOf(range(1, 600)), { threshold: 5, firstRows: 2 }), null);
});

test("sans réglage, le seuil et le premier lot sont ceux du widget", async () => {
  const { planFirstUnfoldStage, UNFOLD_STAGING_THRESHOLD, UNFOLD_FIRST_ROWS } = await load();
  const displayed = idsOf([1]);

  assert.equal(planFirstUnfoldStage(planning(1 + UNFOLD_STAGING_THRESHOLD), displayed), null);
  const first = planFirstUnfoldStage(planning(2 + UNFOLD_STAGING_THRESHOLD), displayed);
  assert.equal(first.groups.length, 1 + UNFOLD_FIRST_ROWS);
  // Le premier lot doit laisser un vrai reste, sinon le second temps ne sert à rien.
  assert.ok(UNFOLD_FIRST_ROWS < UNFOLD_STAGING_THRESHOLD);
});

// File d'attente factice : `flush` joue ce que le navigateur ferait après l'affichage.
function manualSchedule() {
  const queue = [];
  const schedule = (callback) => { queue.push(callback); };
  schedule.flush = () => { queue.splice(0).forEach((callback) => callback()); };
  return schedule;
}

test("le second temps part après le premier, une fois l'affichage fait", async () => {
  const { createTwoStageRunner } = await load();
  const schedule = manualSchedule();
  const runner = createTwoStageRunner(schedule);
  const log = [];

  runner.run(() => log.push("premier"), () => log.push("reste"));
  assert.deepEqual(log, ["premier"]);

  schedule.flush();
  assert.deepEqual(log, ["premier", "reste"]);
});

test("un autre affichage entre les deux temps annule le reste", async () => {
  const { createTwoStageRunner } = await load();
  const schedule = manualSchedule();
  const runner = createTwoStageRunner(schedule);
  const log = [];

  runner.run(() => log.push("premier"), () => log.push("reste"));
  runner.cancel();
  schedule.flush();

  assert.deepEqual(log, ["premier"]);
});

test("un second dépli lancé avant la fin du premier remplace son reste", async () => {
  const { createTwoStageRunner } = await load();
  const schedule = manualSchedule();
  const runner = createTwoStageRunner(schedule);
  const log = [];

  runner.run(() => log.push("premier A"), () => log.push("reste A"));
  runner.run(() => log.push("premier B"), () => log.push("reste B"));
  schedule.flush();

  assert.deepEqual(log, ["premier A", "premier B", "reste B"]);
});

test("un affichage fait pendant le premier temps n'est pas annulé par lui", async () => {
  const { createTwoStageRunner } = await load();
  const schedule = manualSchedule();
  const runner = createTwoStageRunner(schedule);
  const log = [];

  // Le premier temps affiche le planning : cet affichage ne doit pas annuler son propre reste.
  runner.run(() => { runner.cancel(); log.push("premier"); }, () => log.push("reste"));
  schedule.flush();

  assert.deepEqual(log, ["premier", "reste"]);
});
