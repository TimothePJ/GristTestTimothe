const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const runtimePath = path.join(__dirname, "..", "grist-service-context.js");
const runtimeSource = fs.readFileSync(runtimePath, "utf8");

test("le runtime ne remplace pas les accesseurs Grist en lecture seule", () => {
  assert.doesNotMatch(runtimeSource, /\bgrist\.onRecords\s*=/);
  assert.doesNotMatch(runtimeSource, /\bgrist\.onRecord\s*=/);
  assert.match(runtimeSource, /onRecords:\s*subscribeToRecords/);
  assert.match(runtimeSource, /onRecord:\s*subscribeToRecord/);
});

test("le runtime filtre le catalogue Projet et protège les écritures métier", () => {
  assert.match(runtimeSource, /core\.getAllowedProjects\(state\.teamRow, state\.catalogProjects\)/);
  assert.match(runtimeSource, /core\.filterProjectsRaw\(raw, state\.projects\)/);
  assert.match(runtimeSource, /some\(core\.isProtectedMutationAction\)/);
  assert.match(runtimeSource, /projectName:\s*project\?\.name/);
});

test("le runtime utilise le mode d'accès commun pour l'interface et les écritures", () => {
  assert.match(runtimeSource, /function getCurrentAccessMode\(\)/);
  assert.match(runtimeSource, /function canEditCurrentSelection\(\)/);
  assert.match(runtimeSource, /Aucun accès à ce projet/);
});
