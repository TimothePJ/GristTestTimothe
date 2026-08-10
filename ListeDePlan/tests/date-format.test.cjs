'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'affichage.js'),
  'utf8'
);

function extractFunction(name) {
  const marker = `function ${name}(`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `${name} introuvable dans affichage.js`);
  const braceStart = source.indexOf('{', start);
  let depth = 0;
  for (let index = braceStart; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    else if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`fin de ${name} introuvable`);
}

const context = vm.createContext({ Date });
vm.runInContext([
  extractFunction('parsePlanningSyncDate'),
  extractFunction('toGristDateValue'),
  extractFunction('convertFrToDate'),
  extractFunction('convertToISO'),
  extractFunction('formatDate'),
  'globalThis.dateApi = { parsePlanningSyncDate, convertFrToDate, convertToISO, formatDate };',
].join('\n'), context);

const dateApi = context.dateApi;

test('les dates francaises ne sont jamais inversees', () => {
  assert.equal(dateApi.formatDate('27/11/2025'), '27/11/2025');
  assert.equal(dateApi.formatDate('06/03/2026'), '06/03/2026');
  assert.equal(dateApi.formatDate('11/05/2026'), '11/05/2026');
});

test('les dates ISO gardent leur jour civil', () => {
  assert.equal(dateApi.formatDate('2026-06-24'), '24/06/2026');
  assert.equal(dateApi.formatDate('2026-06-24T00:00:00.000Z'), '24/06/2026');
  assert.equal(dateApi.convertToISO('24/06/2026'), '2026-06-24T00:00:00.000Z');
});

test('les timestamps Grist en secondes, texte ou millisecondes restent lisibles', () => {
  const milliseconds = Date.UTC(2026, 6, 22);
  const seconds = milliseconds / 1000;
  assert.equal(dateApi.formatDate(seconds), '22/07/2026');
  assert.equal(dateApi.formatDate(String(seconds)), '22/07/2026');
  assert.equal(dateApi.formatDate(milliseconds), '22/07/2026');
});

test('une date invalide ne produit pas une date inventee', () => {
  assert.equal(dateApi.formatDate('31/02/2026'), '');
  assert.equal(dateApi.formatDate(''), '');
  assert.equal(dateApi.convertToISO('date inconnue'), null);
});
