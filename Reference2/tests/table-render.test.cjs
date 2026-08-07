'use strict';

// Les dates dépendent du fuseau : on fige celui du chantier.
process.env.TZ = 'Europe/Paris';

const test = require('node:test');
const assert = require('node:assert/strict');
const { extractArray, extractFunction, loadLegacyFunctions } = require('./legacy-source.cjs');

const { formatReferenceTableDate } = loadLegacyFunctions([
  'parseReferenceRetardCalendarDate',
  'isEmptyReferenceRetardDate',
  'formatReferenceTableDate',
]);

const REFERENCE_TABLE_COLUMNS = extractArray('REFERENCE_TABLE_COLUMNS');

test('une date Grist arrive en secondes et doit rester lisible', () => {
  // 1713225600 s = 16/04/2024 ; lu comme des millisecondes il donnerait 20/01/1970.
  assert.equal(formatReferenceTableDate(1713225600), '16/04/2024');
  assert.equal(formatReferenceTableDate(1772409600), '02/03/2026');
});

test('une date absente ou restee au marqueur 1900-01-01 affiche un tiret', () => {
  assert.equal(formatReferenceTableDate(-2208988800), '-');
  assert.equal(formatReferenceTableDate('1900-01-01'), '-');
  assert.equal(formatReferenceTableDate(null), '-');
  assert.equal(formatReferenceTableDate(''), '-');
});

test('les dates stockees en texte restent acceptees', () => {
  assert.equal(formatReferenceTableDate('2024-04-16'), '16/04/2024');
  assert.equal(formatReferenceTableDate('16/04/2024'), '16/04/2024');
});

test('la liste des colonnes du tableau est fermee', () => {
  assert.deepEqual(REFERENCE_TABLE_COLUMNS, [
    'Emetteur',
    'Reference',
    'Indice',
    'Recu',
    'DescriptionObservations',
    'Remarque',
    'DureeLimite',
    'DateLimite',
    'Retard',
    'Bloquant',
    'Archive',
  ]);
  // Service pilote le filtrage, il n'a rien à faire dans le tableau.
  assert.ok(!REFERENCE_TABLE_COLUMNS.includes('Service'));
});

test('le tableau se construit a partir de la liste fermee, pas des cles recues', () => {
  const populateTableSource = extractFunction('populateTable');
  assert.ok(
    !/buildReferenceTableHeaders|REFERENCE_TABLE_HIDDEN_KEYS/.test(populateTableSource),
    'populateTable ne doit plus déduire ses colonnes des enregistrements'
  );
  assert.ok(populateTableSource.includes('REFERENCE_TABLE_COLUMNS.forEach'));
});
