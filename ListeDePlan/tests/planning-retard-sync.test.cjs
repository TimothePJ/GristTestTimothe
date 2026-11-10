'use strict';

// Synchro ListePlan → Planning_Projet : ListeDePlan écrit Indice, Realise, Date_Realise et
// Retards comme Planning Projet, avec la même règle de retard (jours ouvrés, module partagé
// planningRetard.js) et la même date de réalisation (première diffusion atteignant la cible).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');

const affichageSource = fs.readFileSync(path.join(__dirname, '..', 'affichage.js'), 'utf8');
const realisationModuleUrl = pathToFileURL(
  path.join(__dirname, '..', '..', 'gestion-depenses2', 'assets', 'js', 'utils', 'planningRealisation.js')
).href;

const PROJECT = 'PROJET RETARD';

function planningRow(overrides = {}) {
  return {
    id: 1,
    NomProjet: PROJECT,
    Service: 'Structure',
    ID2: 'C101',
    Taches: 'Voile R+1',
    Type_doc: 'COFFRAGE',
    Zone: 'Z1',
    Indice: '',
    Realise: 0,
    Date_Realise: null,
    Date_Cloture: null,
    Retards: 0,
    Ligne_planning: '',
    Diff_coffrage: '2026-11-01',
    Diff_armature: null,
    Demarrages_travaux: null,
    Duree_3: null,
    ...overrides,
  };
}

function listePlanRow(indice, dateDiffusion) {
  return {
    Nom_projet: PROJECT,
    Service: 'Structure',
    NumeroDocument: 'C101',
    Designation: 'Voile R+1',
    Type_document: 'COFFRAGE',
    Zone: 'Z1',
    Indice: indice,
    DateDiffusion: dateDiffusion,
  };
}

// Charge affichage.js dans un bac à sable, lui donne les tables, lance la synchro et rend
// les UpdateRecord envoyés à Grist. `helpers` : le module partagé, ou le repli local.
async function runSync({ planning, listePlan, useLocalFallback = false }) {
  const appliedActions = [];
  const tables = {
    ListePlan_NDC_COF: listePlan,
    Planning_Projet: planning,
    Projets2: [{ id: 7, Nom_de_projet: PROJECT, Avancement: null }],
  };
  const context = vm.createContext({
    console: { ...console, warn() {}, error: console.error },
    document: { addEventListener() {}, getElementById: () => null, querySelectorAll: () => [] },
    window: { GristServiceContext: { watchContextTables() {} }, setTimeout: () => 0 },
    grist: {
      docApi: {
        fetchTable: async (name) => JSON.parse(JSON.stringify(tables[name] || [])),
        applyUserActions: async (actions) => {
          appliedActions.push(...JSON.parse(JSON.stringify(actions)));
        },
      },
    },
  });
  vm.runInContext(affichageSource, context, { filename: 'affichage.js' });
  context.__sharedHelpers = useLocalFallback ? null : await import(realisationModuleUrl);
  vm.runInContext(
    'loadPlanningRealisationHelpers = async () => globalThis.__sharedHelpers || getLocalPlanningRealisationHelpers();',
    context
  );
  await vm.runInContext('syncPlanningProjetIndicesFromListeDePlan()', context);
  return appliedActions.filter((action) => action[0] === 'UpdateRecord' && action[1] === 'Planning_Projet');
}

test("un indice rediffusé après la réalisation ne déplace ni Date_Realise ni le retard", async () => {
  const actions = await runSync({
    planning: [planningRow()],
    listePlan: [listePlanRow('0', '2026-10-20'), listePlanRow('A', '2026-11-05'), listePlanRow('B', '2026-11-25')],
  });
  assert.equal(actions.length, 1);
  assert.deepEqual(actions[0][3], { Indice: 'B', Realise: 100, Date_Realise: '2026-11-05', Retards: 4 });
});

test("le retard d'un document réalisé se compte en jours ouvrés", async () => {
  // Du dimanche 01/11 au lundi 09/11 : 8 jours calendaires, 6 jours ouvrés.
  const actions = await runSync({
    planning: [planningRow()],
    listePlan: [listePlanRow('A', '2026-11-09')],
  });
  assert.equal(actions[0][3].Retards, 6);
  assert.equal(actions[0][3].Date_Realise, '2026-11-09');
});

test("sans le module partagé, la synchro n'écrit ni Date_Realise ni Retards (pas de seconde règle)", async () => {
  const actions = await runSync({
    planning: [planningRow({ Retards: 3 })],
    listePlan: [listePlanRow('A', '2026-11-09')],
    useLocalFallback: true,
  });
  assert.equal(actions.length, 1);
  assert.deepEqual(actions[0][3], { Indice: 'A', Realise: 100 });
});
