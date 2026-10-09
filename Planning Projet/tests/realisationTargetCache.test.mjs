import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { createRealisationTargetCache } from "../assets/js/services/realisationTargetCache.js";
import {
  buildPlanningRealiseUpdates,
  buildProjectRealisationTargetLookup,
} from "../assets/js/services/planningService.js";

const mainJs = await readFile(new URL("../assets/js/main.js", import.meta.url), "utf8");

// Configuration d'avancement tenue par service : un coffrage est réalisé à 100 % à l'indice B
// pour Structure, à l'indice C pour Synthese.
const CONFIGS = [{
  projectName: "ERA",
  avancementConfigRaw: JSON.stringify({
    services: {
      Structure: [{ typeDocument: "COFFRAGE", indice: "B" }],
      Synthese: [{ typeDocument: "COFFRAGE", indice: "C" }],
    },
  }),
}];

// Réalisation calculée d'un coffrage à l'indice A, d'après une table d'indices de référence.
function realiseAtIndiceA(lookup) {
  const row = { id: 1, NomProjet: "ERA", Service: "Structure", ID2: "3021", Taches: "PH SS1 - COF", Type_doc: "COFFRAGE", Indice: "A", Realise: 0 };
  return buildPlanningRealiseUpdates([row], lookup)[0]?.realise;
}

test("table des indices de référence : pour le service demandé, sinon pour le service affiché", () => {
  assert.equal(buildProjectRealisationTargetLookup(CONFIGS, "Structure").get("era").get("COFFRAGE"), "B");
  assert.equal(buildProjectRealisationTargetLookup(CONFIGS, "Synthese").get("era").get("COFFRAGE"), "C");
  assert.equal(buildProjectRealisationTargetLookup(CONFIGS).get("era").get("COFFRAGE"), "B", "sans contexte : Structure");
});

test("changement de service : l'indice de référence est celui du service affiché, pas celui du chargement", () => {
  let service = "Synthese";
  const cache = createRealisationTargetCache({
    build: buildProjectRealisationTargetLookup,
    getService: () => service,
  });
  cache.setConfigs(CONFIGS);
  assert.equal(realiseAtIndiceA(cache.get()), 50, "vue Synthese : référence C, l'indice A vaut 2 pas sur 4");
  service = "Structure";
  assert.equal(realiseAtIndiceA(cache.get()), 67, "vue Structure : référence B, l'indice A vaut 2 pas sur 3");
  service = "Synthese";
  assert.equal(realiseAtIndiceA(cache.get()), 50, "retour en vue Synthese");
});

test("la table n'est refaite que si le service ou les configurations changent", () => {
  let service = "Structure";
  const builds = [];
  const cache = createRealisationTargetCache({
    build: (configs, selectedService) => {
      builds.push({ configs, selectedService });
      return buildProjectRealisationTargetLookup(configs, selectedService);
    },
    getService: () => service,
  });
  cache.setConfigs(CONFIGS);
  const first = cache.get();
  assert.equal(cache.get(), first, "même service : même table");
  assert.equal(builds.length, 1);
  service = "Synthese";
  cache.get();
  assert.deepEqual(builds.map((call) => call.selectedService), ["Structure", "Synthese"]);
  cache.setConfigs([]);
  assert.equal(cache.get().size, 0, "configurations relues : table refaite");
  assert.equal(builds.length, 3);
});

test("service pas encore connu : la table est construite avec le service par défaut", () => {
  const builds = [];
  const cache = createRealisationTargetCache({
    build: (configs, selectedService) => {
      builds.push(selectedService);
      return buildProjectRealisationTargetLookup(configs, selectedService);
    },
    getService: () => "",
  });
  cache.setConfigs(CONFIGS);
  assert.equal(cache.get().get("era").get("COFFRAGE"), "B");
  assert.deepEqual(builds, [undefined]);
  cache.setConfigs(null);
  assert.equal(cache.get().size, 0, "configurations absentes : table vide");
});

test("main.js : la table des indices de référence suit le service affiché, à chaque usage", () => {
  assert.match(mainJs, /import \{ createRealisationTargetCache \} from "\.\/services\/realisationTargetCache\.js";/);
  assert.match(
    mainJs,
    /const realisationTargets = createRealisationTargetCache\(\{\s*build: buildProjectRealisationTargetLookup,\s*getService: \(\) => window\.GristServiceContext\?\.getService\?\.\(\) \|\| "",\s*\}\);/
  );
  assert.equal(mainJs.match(/realisationTargets\.setConfigs\(cachedProjectAvancementConfigs\);/g)?.length, 2);
  assert.equal(mainJs.match(/realisationTargets\.get\(\)/g)?.length, 4, "rendu depuis le cache, lignes affichées, synchronisation, rendu");
  assert.ok(!mainJs.includes("cachedRealisationTargetLookup"), "plus de table gardée d'un service à l'autre");
});
