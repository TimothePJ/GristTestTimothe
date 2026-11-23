// Les tests du service le chargent par une URL « data: » et réécrivent l'adresse de ses
// modules partagés : ils ne voient donc pas un chemin d'import faux. Dans le navigateur, un
// chemin faux empêche tout le widget de démarrer. Ce test lit les chemins tels qu'écrits.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const serviceDir = path.join(__dirname, "..", "assets", "js", "services");
const source = fs.readFileSync(path.join(serviceDir, "gristService.js"), "utf8");
const specifiers = [...source.matchAll(/from\s+"(\.{1,2}\/[^"]+)"/g)].map((match) => match[1]);

test("chaque module importé par le service existe à l'adresse écrite", () => {
  const shared = specifiers.filter((specifier) => specifier.includes("gestion-depenses2/"));
  assert.equal(shared.length, 2, "règle des dates et suivi des données d'entrée");

  for (const specifier of specifiers) {
    assert.ok(
      fs.existsSync(path.resolve(serviceDir, specifier)),
      `module introuvable : ${specifier}`
    );
  }
});

// Mêmes modules, même adresse relative que Planning Projet (même profondeur de dossier) :
// les deux widgets doivent partager la règle, pas en tenir chacun une copie.
test("les modules partagés sont ceux qu'importe Planning Projet", () => {
  const planningSource = fs.readFileSync(
    path.join(__dirname, "..", "..", "Planning Projet", "assets", "js", "services", "gristService.js"),
    "utf8"
  );

  for (const specifier of specifiers.filter((item) => item.includes("gestion-depenses2/"))) {
    assert.ok(
      planningSource.includes(`from "${specifier}"`),
      `Planning Projet n'importe pas ${specifier}`
    );
  }
});
