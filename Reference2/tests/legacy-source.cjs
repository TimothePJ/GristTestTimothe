'use strict';

// `js/legacy.js` est un script de navigateur : il touche le DOM dès son
// chargement et ne s'exporte pas. Pour le tester on en extrait les fonctions
// pures, ce qui garantit au passage qu'elles existent toujours sous ce nom.

const fs = require('node:fs');
const path = require('node:path');

const SOURCE = fs.readFileSync(
  path.join(__dirname, '..', 'js', 'legacy.js'),
  'utf8'
);

function extractFunction(name) {
  const start = SOURCE.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`fonction ${name} introuvable dans legacy.js`);

  // Le corps commence à la première accolade rencontrée hors de la liste de
  // paramètres : sinon un paramètre déstructuré la ferait démarrer trop tôt.
  let parenDepth = 0;
  let bodyStart = -1;
  for (let index = start; index < SOURCE.length; index += 1) {
    const character = SOURCE[index];
    if (character === '(') parenDepth += 1;
    else if (character === ')') parenDepth -= 1;
    else if (character === '{' && parenDepth === 0) {
      bodyStart = index;
      break;
    }
  }
  if (bodyStart < 0) throw new Error(`corps de ${name} introuvable`);

  let depth = 0;
  for (let index = bodyStart; index < SOURCE.length; index += 1) {
    if (SOURCE[index] === '{') depth += 1;
    else if (SOURCE[index] === '}') {
      depth -= 1;
      if (!depth) return SOURCE.slice(start, index + 1);
    }
  }

  throw new Error(`fonction ${name} non terminée`);
}

function extractArray(name) {
  const match = SOURCE.match(new RegExp(`const ${name} = (\\[[^\\]]*\\]);`));
  if (!match) throw new Error(`tableau ${name} introuvable dans legacy.js`);
  return new Function(`return ${match[1]};`)();
}

// Recompose les fonctions demandées dans un bac à sable isolé. `globals` fournit
// ce que le navigateur donnerait normalement (window, constantes…).
function loadLegacyFunctions(names, globals = {}) {
  const body = [
    ...Object.keys(globals).map(
      (key) => `const ${key} = __globals[${JSON.stringify(key)}];`
    ),
    ...names.map(extractFunction),
    `return { ${names.join(', ')} };`,
  ].join('\n');

  return new Function('__globals', body)(globals);
}

module.exports = { SOURCE, extractArray, extractFunction, loadLegacyFunctions };
