'use strict';

// Contrat « rafraîchissement événementiel », vérifié sur les widgets livrés.
// Le runtime partagé ne relit plus sur minuterie : un widget qui réintroduirait
// une interrogation périodique, ou qui reprendrait la main sur le flux natif,
// annulerait le bénéfice sans que rien ne le signale.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO = path.join(__dirname, '..', '..');

const WIDGETS = [
  'Reference2',
  'EnAttente',
  'Bordereau',
  'ListeDePlan',
  'Avancement',
  'creation-projet',
  'Planning Projet',
  'planning-synchro',
  'MS Project',
  'Time-Out',
  'gestion-depenses2',
  'Gestion-globale',
  'Gestion-User',
  'gestion-equipe',
  'gestion-acces-interservices',
];

// Code tiers recopié : il n'est pas soumis au contrat.
const IGNORED_SEGMENTS = ['node_modules', 'vendor', 'dev', 'tests'];

function collectScripts(directory) {
  const absolute = path.join(REPO, directory);
  if (!fs.existsSync(absolute)) return [];

  const scripts = [];
  const walk = (current) => {
    fs.readdirSync(current, { withFileTypes: true }).forEach((entry) => {
      if (IGNORED_SEGMENTS.includes(entry.name)) return;
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) walk(target);
      else if (entry.name.endsWith('.js')) scripts.push(target);
    });
  };
  walk(absolute);
  return scripts;
}

function loadsSharedRuntime(directory) {
  const absolute = path.join(REPO, directory);
  return fs.readdirSync(absolute)
    .filter((name) => name.endsWith('.html'))
    .some((name) => fs.readFileSync(path.join(absolute, name), 'utf8')
      .includes('grist-service-context.js'));
}

test('les widgets livres sont tous presents', () => {
  WIDGETS.forEach((directory) => {
    assert.ok(
      fs.existsSync(path.join(REPO, directory)),
      `widget ${directory} introuvable : mettre la liste à jour`
    );
    assert.ok(collectScripts(directory).length > 0, `aucun script trouvé dans ${directory}`);
  });
});

test('aucun widget n arme de minuterie de relecture', () => {
  WIDGETS.forEach((directory) => {
    collectScripts(directory).forEach((script) => {
      const source = fs.readFileSync(script, 'utf8');
      assert.doesNotMatch(
        source,
        /setInterval\s*\(/,
        `${path.relative(REPO, script)} : les données se rafraîchissent sur évènement, pas sur minuterie`
      );
    });
  });
});

test('aucun widget ne force un intervalle de surveillance', () => {
  WIDGETS.forEach((directory) => {
    collectScripts(directory).forEach((script) => {
      const source = fs.readFileSync(script, 'utf8');
      assert.doesNotMatch(
        source,
        /pollIntervalMs/,
        `${path.relative(REPO, script)} : le défaut du runtime est zéro, ne pas le rouvrir`
      );
    });
  });
});

test('un widget branche sur le runtime ne reprend pas le flux natif', () => {
  WIDGETS.filter(loadsSharedRuntime).forEach((directory) => {
    collectScripts(directory).forEach((script) => {
      const source = fs.readFileSync(script, 'utf8');
      // Le runtime possède l'abonnement onRecords : il s'en sert comme signal de
      // changement. Un second abonnement recevrait les lignes de la section hôte,
      // qui n'est plus forcément la table affichée.
      assert.doesNotMatch(
        source,
        /\bgrist\s*\.\s*onRecords\s*\(/,
        `${path.relative(REPO, script)} : passer par watchContextTable`
      );
    });
  });
});

// Le contrat ne dit pas seulement « pas de minuterie » : il dit aussi que l'écran
// suit les données. Un widget qui n'observe aucune table oblige l'utilisateur à
// recharger la page pour voir sa propre modification — c'est le défaut qui a
// motivé ce lot, et rien ne le signalait.
test('chaque widget branche sur le runtime observe au moins une table', () => {
  WIDGETS.filter(loadsSharedRuntime).forEach((directory) => {
    const observes = collectScripts(directory).some((script) => {
      const source = fs.readFileSync(script, 'utf8');
      // Certains widgets appellent l'API en chaînage optionnel : watchContextTables?.(
      return /watchContextTables?(\?\.)?\s*\(/.test(source);
    });
    assert.ok(
      observes,
      `${directory} : aucun watchContextTable(s) — l'utilisateur devra recharger la page`
    );
  });
});

// gestion-acces-interservices lit les tables sans filtre et ne charge donc pas le
// runtime. Il doit malgré tout apprendre les modifications faites ailleurs, via le
// même signal inter-widgets.
test('un widget sans runtime ecoute quand meme le signal de modification', () => {
  WIDGETS.filter((directory) => !loadsSharedRuntime(directory)).forEach((directory) => {
    const listens = collectScripts(directory).some((script) => {
      const source = fs.readFileSync(script, 'utf8');
      return source.includes('DATA_CHANGED_STORAGE_KEY');
    });
    assert.ok(
      listens,
      `${directory} : ni runtime ni signal de modification, l'écran restera périmé`
    );
  });
});
