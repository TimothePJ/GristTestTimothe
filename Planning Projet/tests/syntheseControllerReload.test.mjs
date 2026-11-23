// Le contrôleur garde en mémoire les lignes affichées et leurs sections tant que rien n'a changé.
// Garde-fou : deux contrôleurs reçoivent la même suite d'opérations tirées au hasard ; l'un relit
// Grist avant chaque opération (tout est alors recalculé), l'autre ne relit jamais (il vit sur ce
// qu'il a gardé). Ils doivent écrire la même chose dans Grist et afficher les mêmes lignes : un
// calcul gardé à tort, ou des sections modifiées par une opération, les feraient diverger.
import test from "node:test";
import assert from "node:assert/strict";

import { createSyntheseTasksController } from "../assets/js/ui/syntheseTasksController.js";
import { createMemoryDocApi } from "../assets/js/services/memoryDocApi.js";
import { resolveDropSlot } from "../assets/js/services/syntheseTaskOrder.js";
import { ERA_PROJECT, eraSs1Rows } from "./helpers/eraSs1Rows.mjs";

const TODAY = new Date(2026, 0, 12);
const DAY_MS = 24 * 60 * 60 * 1000;

// Trois étages de l'export réel : deux dans une zone, un dans une autre.
function projectRows() {
  const copies = [
    { offset: 0, zone: "Zone 1 / BAT BC", floor: "SS1" },
    { offset: 10000, zone: "Zone 1 / BAT BC", floor: "SS2" },
    { offset: 20000, zone: "Zone 2", floor: "SS1" },
  ];
  return copies.flatMap(({ offset, zone, floor }) => eraSs1Rows().map((row) => {
    const shifted = { ...row, id: row.id + offset, Zone: zone };
    if (row.Etage) shifted.Taches = floor;
    else shifted.Groupe = floor;
    if (row.Parent) shifted.Parent = String(Number(row.Parent) + offset);
    if (row.Lien) shifted.Lien = row.Lien.replace(/^\d+/, (id) => String(Number(id) + offset));
    return shifted;
  }));
}

function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

async function settle() {
  for (let turn = 0; turn < 4; turn += 1) await flush();
}

// Un contrôleur sur un faux Grist en mémoire (le vrai applique les mêmes actions).
async function createEnv() {
  const memory = createMemoryDocApi({ rows: projectRows(), defaults: { Service: "Synthese", NomProjet: ERA_PROJECT } });
  const state = {
    currentProject: { name: ERA_PROJECT, names: [ERA_PROJECT] },
    selectedService: "Synthese",
    accessMode: "editable",
  };
  const table = { renders: [], callbacks: null };
  let submitLink = null;
  const controller = createSyntheseTasksController({
    context: {
      getState: () => state,
      fetchContextRows: async () => memory.getRows(),
      subscribe: () => () => {},
      watchProjectZones: () => () => {},
    },
    docApi: memory,
    createTable(callbacks) {
      table.callbacks = callbacks;
      return {
        render: (lines, options) => table.renders.push({ lines, options }),
        setStatus() {},
        startEditing() {},
        startEditingFloor() {},
        startEditingGroup() {},
        startEditingStorey() {},
      };
    },
    confirm: () => true,
    now: () => TODAY,
    timers: { setTimeout: () => 0, clearTimeout() {} },
    createLinkDialog: ({ onSubmit }) => {
      submitLink = onSubmit;
      return { open() {}, close() {} };
    },
  });
  controller.setEditingEnabled(true);
  controller.setActive(true);
  await settle();
  return {
    memory,
    controller,
    callbacks: table.callbacks,
    lines: () => table.renders.at(-1).lines,
    submitLink: (link) => submitLink(link),
  };
}

function seeded(seed) {
  let state = seed;
  return (max) => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state % max;
  };
}

const isoDay = (offset) => new Date(Date.UTC(2025, 10, 3) + offset * DAY_MS).toISOString().slice(0, 10);

// Une opération, toutes ses valeurs tirées d'avance : elle est jouée telle quelle sur les deux contrôleurs.
function chooseOperation(lines, random, step) {
  const tasks = lines.filter((line) => line.kind === "task");
  const groups = lines.filter((line) => line.kind === "group");
  const floors = lines.filter((line) => line.kind === "floor");
  const zones = lines.filter((line) => line.kind === "zone");
  const task = tasks.length ? tasks[random(tasks.length)] : null;
  const group = groups.length ? groups[random(groups.length)] : null;
  const kind = random(24);
  // Changements de vue seuls : rien n'est écrit, les calculs gardés en mémoire resservent.
  if (kind === 20 && zones.length) {
    const zone = zones[random(zones.length)];
    return { label: `replie la zone ${zone.zoneKey}`, run: (env) => env.callbacks.onToggleZone(zone.zoneKey) };
  }
  if (kind === 21 && floors.length) {
    const floor = floors[random(floors.length)];
    return { label: `replie ${floor.key}`, run: (env) => env.callbacks.onToggleFloor(floor.zoneKey, floor.floorKey) };
  }
  if (kind === 22) {
    const layout = random(2) ? "floor" : "zone";
    return { label: `affichage ${layout}`, run: (env) => env.controller.setLayout(layout) };
  }
  if (kind === 23 && group) {
    return { label: `replie ${group.groupRowId}`, run: (env) => env.callbacks.onToggleGroup(group.groupRowId) };
  }
  if (task && kind < 4) {
    const days = String(random(13));
    return { label: `durée ${task.taskId} = ${days}`, run: (env) => env.callbacks.onEdit(task.taskId, "duration", days) };
  }
  if (task && kind < 6) {
    const field = random(2) ? "start" : "end";
    const date = isoDay(random(150));
    return { label: `${field} ${task.taskId} = ${date}`, run: (env) => env.callbacks.onEdit(task.taskId, field, date) };
  }
  if (task && kind < 7) {
    return { label: `nom ${task.taskId}`, run: (env) => env.callbacks.onEdit(task.taskId, "name", `Tâche ${step}`) };
  }
  if (task && kind < 10) {
    const meeting = random(4) === 0;
    const args = [task.zoneKey, task.floorKey || "", task.groupRowId ?? null, task.taskId];
    return {
      label: `${meeting ? "réunion" : "tâche"} sous ${task.taskId}`,
      run: (env) => (meeting ? env.callbacks.onAddMeeting(...args) : env.callbacks.onAddTask(...args)),
    };
  }
  if (task && kind < 12) {
    return { label: `supprime ${task.taskId}`, run: (env) => env.callbacks.onDeleteTask(task.taskId) };
  }
  if (task && kind < 14) {
    const others = tasks.filter((other) => other.zoneKey === task.zoneKey && other.taskId !== task.taskId);
    const link = others.length && random(5)
      ? { predId: others[random(others.length)].taskId, type: ["FD", "DD", "FF"][random(3)], lag: random(4) - 1 }
      : null;
    return {
      label: `lien ${task.taskId} → ${link ? `${link.predId} ${link.type}${link.lag}` : "aucun"}`,
      run: (env) => {
        env.callbacks.onEditLink(task.taskId);
        return env.submitLink(link);
      },
    };
  }
  if (task && !task.floorEnd && kind < 16) {
    const target = resolveDropSlot(lines[random(lines.length)], random(2) ? "before" : "after", {
      canOrder: true,
      draggedTaskId: task.taskId,
      draggedZoneKey: task.zoneKey,
    });
    if (target) return { label: `glisse ${task.taskId} vers ${target.key}`, run: (env) => env.callbacks.onMoveTask(task.taskId, target) };
  }
  if (group && kind < 17) {
    const mode = random(2) ? "series" : "parallel";
    return { label: `cycle ${group.groupRowId} ${mode}`, run: (env) => env.callbacks.onSetCycleMode(group.groupRowId, mode) };
  }
  if (kind < 18 && (group || floors.length)) {
    const host = group && random(2) ? group : floors[random(floors.length)] || group;
    const parent = host.kind === "group" ? host.groupRowId : null;
    return { label: `cycle dans ${host.key}`, run: (env) => env.callbacks.onAddCycle(host.zoneKey, host.floorKey, parent) };
  }
  if (group && kind < 19) {
    return random(3)
      ? { label: `replie ${group.groupRowId}`, run: (env) => env.callbacks.onToggleGroup(group.groupRowId) }
      : { label: `supprime le cycle ${group.groupRowId}`, run: (env) => env.callbacks.onDeleteGroup(group.groupRowId) };
  }
  const filter = random(3) ? "" : "Zone 2";
  return { label: `filtre « ${filter} »`, run: (env) => env.controller.setZoneFilter(filter) };
}

async function runSequence(seed, steps) {
  const random = seeded(seed);
  const kept = await createEnv();
  const reread = await createEnv();
  let changed = 0;
  for (let step = 1; step <= steps; step += 1) {
    await reread.controller.refresh();
    await settle();
    const operation = chooseOperation(kept.lines(), random, step);
    const before = JSON.stringify(kept.memory.getRows());
    for (const env of [kept, reread]) {
      await operation.run(env);
      await settle();
    }
    const where = `tirage ${seed}, opération ${step} (${operation.label})`;
    assert.deepEqual(kept.memory.getRows(), reread.memory.getRows(), `lignes écrites dans Grist — ${where}`);
    assert.deepEqual(kept.lines(), reread.lines(), `lignes affichées — ${where}`);
    if (JSON.stringify(kept.memory.getRows()) !== before) changed += 1;
  }
  return changed;
}

for (const seed of [11, 23, 47]) {
  test(`mêmes écritures et même affichage avec ou sans relecture avant chaque opération (tirage ${seed})`, async () => {
    const changed = await runSequence(seed, 90);
    assert.ok(changed >= 25, `la suite doit vraiment modifier le projet : ${changed} opérations sur 90 l'ont fait`);
  });
}
