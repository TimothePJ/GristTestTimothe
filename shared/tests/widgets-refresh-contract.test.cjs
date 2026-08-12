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

test('Reference2 accepte son signal Grist historique sans polling', () => {
  const source = fs.readFileSync(
    path.join(REPO, 'Reference2', 'js', 'legacy.js'),
    'utf8'
  );
  assert.match(
    source,
    /watchContextTable\(['"]References2['"][\s\S]*?acceptAnyNativeTableSignal:\s*true/
  );
  assert.match(
    source,
    /nativeSignalFilter:\s*window\.ReferenceProjectSyncRelay\?\.acceptNativeSignalForCurrentProject/
  );
  assert.match(source, /projectScopedSignals:\s*true/);
  assert.match(source, /REFERENCE_DATA_CHANGE_STORAGE_KEY[\s\S]*?refreshContextTables/);
  assert.doesNotMatch(source, /pollIntervalMs|setInterval\s*\(/);
});

test('EnAttente suit References2 sur evenement sans polling', () => {
  const source = fs.readFileSync(
    path.join(REPO, 'EnAttente', 'js', 'grist.js'),
    'utf8'
  );
  assert.match(
    source,
    /watchContextTable\(['"]References2['"][\s\S]*?acceptAnyNativeTableSignal:\s*true/
  );
  assert.match(
    source,
    /nativeSignalFilter:\s*window\.ReferenceProjectSyncRelay\?\.acceptNativeSignalForCurrentProject/
  );
  assert.match(source, /projectScopedSignals:\s*true/);
  assert.match(source, /grist\.references-data-change[\s\S]*?refreshContextTables/);
  assert.doesNotMatch(source, /pollIntervalMs|setInterval\s*\(/);
});

test('les deux vues ListeDePlan suivent leur table sur evenement sans polling', () => {
  for (const relativePath of ['ListeDePlan/script.js', 'ListeDePlan/avancement.js']) {
    const source = fs.readFileSync(path.join(REPO, relativePath), 'utf8');
    assert.match(
      source,
      /watchContextTable\(['"]ListePlan_NDC_COF['"][\s\S]*?acceptAnyNativeTableSignal:\s*true/,
      `${relativePath} doit accepter le signal de sa vue Grist historique`
    );
    assert.match(
      source,
      /nativeSignalFilter:\s*window\.ListePlanSyncRelay\?\.acceptNativeSignalForCurrentProject/,
      `${relativePath} doit ignorer les signaux des autres projets`
    );
    assert.doesNotMatch(source, /pollIntervalMs|setInterval\s*\(/);
  }
});

test('les widgets projet agreges utilisent le relais cible sans polling', () => {
  const widgets = [
    ['Bordereau/bordereau.html', 'Bordereau/bordereau.js'],
    ['Planning Projet/index.html', 'Planning Projet/assets/js/main.js'],
    ['Avancement/index.html', 'Avancement/js/avancement.js'],
    ['planning-synchro/index.html', 'planning-synchro/assets/js/main.js'],
    ['gestion-depenses2/index.html', 'gestion-depenses2/assets/js/main.js'],
  ];

  widgets.forEach(([htmlPath, scriptPath]) => {
    const html = fs.readFileSync(path.join(REPO, htmlPath), 'utf8');
    const script = fs.readFileSync(path.join(REPO, scriptPath), 'utf8');
    const runtimeIndex = html.indexOf('../shared/grist-service-context.js');
    const relayIndex = html.indexOf('../shared/project-mutation-sync-relay.js');

    assert.ok(runtimeIndex >= 0 && relayIndex > runtimeIndex, `${htmlPath} doit charger le relais`);
    assert.match(html, /ProjectMutationSyncConfig[\s\S]*?mutationSignals/);
    assert.match(
      script,
      /nativeSignalFilter:\s*window\.ProjectMutationSyncRelay\?\.acceptNativeSignalForCurrentProject/,
      `${scriptPath} doit filtrer le signal Projets2`
    );
    assert.match(script, /projectScopedSignals:\s*true/);
    assert.match(script, /acceptAnyNativeTableSignal:\s*true/);
    assert.doesNotMatch(script, /pollIntervalMs|setInterval\s*\(/);
  });
});

// gestion-acces-interservices lit les tables sans filtre et ne charge donc pas le
// runtime. Il doit malgré tout apprendre les modifications faites ailleurs, via le
// même signal inter-widgets.
test('un widget sans runtime ecoute quand meme le signal de modification', () => {
  WIDGETS.filter((directory) => !loadsSharedRuntime(directory)).forEach((directory) => {
    // MS Project est volontairement figé tant qu'aucun nom n'est choisi et ne
    // doit pas recevoir de signal global qui déclencherait une lecture métier.
    if (directory === 'MS Project') return;
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

// Une section se redessine avec des donnees perimees quand le widget LIT une table
// qu'il ne SURVEILLE pas : le reveil n'arrive jamais pour elle. C'est ainsi que
// « Gestion - Equipe » est restee figee (Team lue, non surveillee) et que le
// Previsionnel ignorait les absences (Time-Out lue, non surveillee). Ce test
// compare les deux listes a la source.
test('gestion-depenses2 surveille toutes les tables qu il relit', () => {
  const main = fs.readFileSync(
    path.join(REPO, 'gestion-depenses2', 'assets', 'js', 'main.js'),
    'utf8'
  );
  const service = fs.readFileSync(
    path.join(REPO, 'gestion-depenses2', 'assets', 'js', 'services', 'gristService.js'),
    'utf8'
  );

  // Ce que le widget relit a chaque chargement de donnees. On se limite au corps de
  // fetchProjectDataTables : les autres lectures du fichier servent des chemins
  // d'ecriture (lire-avant-ecrire) et n'alimentent aucun affichage.
  const chargement = service.match(
    /export async function fetchProjectDataTables\(\)\s*\{([\s\S]*?)\n\}/
  );
  assert.ok(chargement, 'fetchProjectDataTables introuvable : adapter le test');
  const relues = new Set(
    Array.from(chargement[1].matchAll(/tables\.([a-zA-Z]+)/g), (found) => found[1])
  );
  // Les absences sont lues via un identifiant resolu, pas via tables.timeOut.
  relues.delete('timeOut');

  // Ce qu'il surveille : le tableau passe a watchContextTables.
  const watchBlocks = Array.from(
    main.matchAll(/watchContextTables\s*\(\s*\[([\s\S]*?)\]/g),
    (found) => found[1]
  );
  assert.ok(watchBlocks.length, 'aucun appel a watchContextTables trouve');
  const surveillees = new Set(
    watchBlocks.flatMap((block) => Array.from(block.matchAll(/tables\.([a-zA-Z]+)/g), (f) => f[1]))
  );

  const manquantes = [...relues].filter((key) => !surveillees.has(key));
  assert.deepEqual(
    manquantes,
    [],
    `tables relues mais non surveillees : ${manquantes.join(', ')} — la section correspondante restera figee`
  );

  // Les absences changent d'identifiant selon le document : la surveillance doit
  // s'enregistrer sur l'identifiant resolu, sinon le reveil ne la trouve pas.
  assert.match(
    main,
    /resolveTimeOutTableId\(\)[\s\S]{0,400}watchContextTables/,
    'la table des absences doit etre surveillee sous son identifiant resolu'
  );
});
