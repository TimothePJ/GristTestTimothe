import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

import { APP_CONFIG } from "../assets/js/config.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mainSource = fs.readFileSync(path.join(ROOT, "assets/js/main.js"), "utf8");
const serviceSource = fs.readFileSync(
  path.join(ROOT, "assets/js/services/gristService.js"),
  "utf8"
);
const indexSource = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");

function readInlineSyncConfig() {
  const script = Array.from(
    indexSource.matchAll(/<script>([\s\S]*?)<\/script>/g),
    (match) => match[1]
  ).find((content) => content.includes("ProjectMutationSyncConfig"));
  assert.ok(script, "configuration ProjectMutationSyncConfig introuvable");
  const sandbox = { window: {}, Object };
  vm.runInNewContext(script, sandbox, { filename: "gestion-depenses2/index.html" });
  return sandbox.window.ProjectMutationSyncConfig;
}

function getExportedFunctionBlocks() {
  const starts = Array.from(
    serviceSource.matchAll(/export async function\s+([A-Za-z0-9_]+)\s*\(/g),
    (match) => ({ name: match[1], index: match.index })
  );
  return starts.map((entry, index) => ({
    name: entry.name,
    source: serviceSource.slice(entry.index, starts[index + 1]?.index),
  }));
}

function getMutationTableKeys(source) {
  const keys = new Set();
  const actionPattern = /["'](?:AddRecord|UpdateRecord|RemoveRecord|BulkAddRecord|BulkUpdateRecord|BulkRemoveRecord)["']\s*,\s*(?:(?:APP_CONFIG\.grist\.)?tables\.([A-Za-z]+)|(tableName))/g;
  for (const match of source.matchAll(actionPattern)) {
    if (match[1]) keys.add(match[1]);
    if (match[2]) {
      const alias = source.match(/const tableName\s*=\s*APP_CONFIG\.grist\.tables\.([A-Za-z]+)/);
      assert.ok(alias, "alias tableName non resolu dans une fonction d'ecriture");
      keys.add(alias[1]);
    }
  }
  return keys;
}

test("chaque donnee saisissable est routee vers le temps reel gestion-depenses2", () => {
  const config = readInlineSyncConfig();
  const mutationKeys = new Set();
  const serviceMutators = getExportedFunctionBlocks()
    .filter((entry) => getMutationTableKeys(entry.source).size > 0);
  const uiMutators = serviceMutators.filter((entry) => (
    new RegExp(`\\b${entry.name}\\s*\\(`).test(mainSource)
  ));

  assert.ok(uiMutators.length, "aucune fonction d'ecriture utilisee par l'interface");
  uiMutators.forEach((entry) => {
    getMutationTableKeys(entry.source)
      .forEach((key) => mutationKeys.add(key));
  });

  const mutationTables = [...mutationKeys].map((key) => {
    const tableName = APP_CONFIG.grist.tables[key];
    assert.ok(tableName, `table APP_CONFIG inconnue pour la cle ${key}`);
    return tableName;
  }).sort();

  assert.deepEqual(
    [...config.editableTables].sort(),
    mutationTables,
    "la liste editableTables doit suivre exactement les ecritures de l'interface"
  );

  const emitted = new Set(config.mutationSignals?.GestionDepenses_Sync || []);
  const observed = new Set(config.observedSignalTables?.GestionDepenses_Sync || []);
  const direct = new Set(config.directSignalTables || []);
  mutationTables.forEach((tableName) => {
    assert.ok(emitted.has(tableName), `${tableName} n'emet pas GestionDepenses_Sync`);
    assert.ok(observed.has(tableName), `${tableName} n'est pas routee au bon watcher`);
    if (tableName !== APP_CONFIG.grist.tables.projects) {
      assert.ok(direct.has(tableName), `${tableName} n'accepte pas sa section Grist directe`);
    }
  });
});

test("chaque table modifiable et affichee est surveillee sans polling", () => {
  const config = readInlineSyncConfig();
  const watcherBlock = mainSource.match(
    /function bindExpenseDataRefresh\(\)\s*\{([\s\S]*?)\n\}/
  );
  assert.ok(watcherBlock, "bindExpenseDataRefresh introuvable");

  const tableKeyByName = new Map(
    Object.entries(APP_CONFIG.grist.tables).map(([key, tableName]) => [tableName, key])
  );
  config.editableTables.forEach((tableName) => {
    const key = tableKeyByName.get(tableName);
    assert.ok(key, `aucune cle APP_CONFIG pour ${tableName}`);
    assert.match(
      watcherBlock[1],
      new RegExp(`\\btables\\.${key}\\b`),
      `${tableName} est modifiable mais son affichage ne sera pas rafraichi`
    );
  });

  assert.doesNotMatch(mainSource, /pollIntervalMs|setInterval\s*\(/);
  assert.doesNotMatch(indexSource, /pollIntervalMs|setInterval\s*\(/);
});
