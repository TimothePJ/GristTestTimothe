// La table des indices de reference (« 100 % realise ») vient de la configuration
// d'avancement du projet, tenue PAR SERVICE. Construite une fois au demarrage, elle restait
// celle du service affiche a ce moment-la : en passant ensuite a un autre service, le planning
// calculait la realisation avec les indices de reference du premier.
//
// `main.js` n'est pas importable sous Node : comme dans postWriteRefresh.test.mjs, on extrait le
// TEXTE REEL de la fonction et on l'execute dans un `vm`, avec le vrai constructeur de table.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

import { buildProjectRealisationTargetLookup } from "../assets/js/top/vendor/planningProjetBuilder.js";

const source = fs.readFileSync(new URL("../assets/js/main.js", import.meta.url), "utf8");

// Extrait un bloc a partir de son en-tete en equilibrant les accolades ; echoue bruyamment
// si l'en-tete a disparu.
function extractBlock(header) {
  const start = source.indexOf(header);
  assert.ok(start >= 0, `bloc introuvable dans main.js : ${header}`);
  const open = start + header.length - 1;
  assert.equal(source[open], "{", `l'en-tete doit se terminer par une accolade : ${header}`);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`accolades non equilibrees dans main.js : ${header}`);
}

// Un coffrage est realise a 100 % a l'indice B pour Structure, a l'indice C pour Synthese.
const CONFIGS = [{
  projectName: "ERA",
  avancementConfigRaw: JSON.stringify({
    services: {
      Structure: [{ typeDocument: "COFFRAGE", indice: "B" }],
      Synthese: [{ typeDocument: "COFFRAGE", indice: "C" }],
    },
  }),
}];

// Le vrai `getRealisationTargetLookup` de main.js, monte sur un contexte de service bouchonne.
function mount({ service }) {
  const current = { service };
  // Le constructeur de table lit le service affiche sur le vrai `globalThis`.
  globalThis.GristServiceContext = { getService: () => current.service };
  const builds = [];
  const sandbox = {
    window: { GristServiceContext: globalThis.GristServiceContext },
    buildProjectRealisationTargetLookup: (configs) => {
      builds.push(current.service);
      return buildProjectRealisationTargetLookup(configs);
    },
    realisationConfigs: CONFIGS,
    realisationTargetLookup: null,
    realisationTargetService: null,
  };
  vm.createContext(sandbox);
  vm.runInContext(extractBlock("  function getRealisationTargetLookup() {"), sandbox);
  return {
    current,
    builds,
    referenceIndice: () => vm.runInContext("getRealisationTargetLookup()", sandbox).get("era").get("COFFRAGE"),
    lookup: () => vm.runInContext("getRealisationTargetLookup()", sandbox),
  };
}

test("changement de service : l'indice de reference est celui du service affiche, pas celui du demarrage", () => {
  const env = mount({ service: "Synthese" });
  assert.equal(env.referenceIndice(), "C");
  env.current.service = "Structure";
  assert.equal(env.referenceIndice(), "B");
  env.current.service = "Synthese";
  assert.equal(env.referenceIndice(), "C");
});

test("meme service : la table n'est pas refaite", () => {
  const env = mount({ service: "Structure" });
  const first = env.lookup();
  assert.equal(env.lookup(), first);
  assert.deepEqual(env.builds, ["Structure"]);
});

test("main.js : le planning demande la table du service affiche a chaque chargement de projet", () => {
  assert.match(source, /targetLookup: getRealisationTargetLookup\(\),/);
  assert.ok(!/targetLookup: realisationTargetLookup,/.test(source), "plus de table gardee depuis le demarrage");
  assert.match(source, /realisationConfigs = \(projectRows \|\| \[\]\)\.map\(/);
});
