'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ALL_VALUE,
  NO_TYPE_VALUE,
  NO_ZONE_VALUE,
  buildDocumentSearchKey,
  matchesDocumentSearch,
  computeDocumentFacets,
} = require('../js/document-filter-utils.js');

// Les deux normaliseurs de clés reproduisent ceux de legacy.js : le type passe par
// normalizeReferenceDocumentIdentityPart (accents conservés), la zone par
// normalizeZoneMatchKey (accents et ponctuation retirés).
function typeKeyOf(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('fr') || NO_TYPE_VALUE;
}

const COMBINING_MARKS = /[̀-ͯ]/g;

function zoneKeyOf(value) {
  return String(value ?? '')
    .trim()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLocaleLowerCase('fr')
    .replace(/[^a-z0-9]/g, '') || NO_ZONE_VALUE;
}

// Extrait réel d'un projet : PH N-D et PH N-U déclinés sur trois types et six zones.
// « 4011 PH  N-U » porte un double espace, tel qu'il existe dans les données.
const RAW_DOCUMENTS = [
  { numero: '1001', name: 'Fondations', type: 'Coffrage', zone: 'Bloc 1' },
  { numero: '1011', name: 'PH N-U', type: 'Coffrage', zone: 'Bloc 1' },
  { numero: '1101', name: 'PH N-D', type: 'Coffrage', zone: 'Bloc 1' },
  { numero: '2011', name: 'PH N-U', type: 'Coffrage', zone: 'Bloc 2' },
  { numero: '2101', name: 'PH N-D', type: 'Coffrage', zone: 'Bloc 2' },
  { numero: '3101', name: 'PH N-D', type: 'Coffrage', zone: 'Bloc 3' },
  { numero: '4011', name: 'PH  N-U', type: 'Coffrage', zone: 'Bloc 4' },
  { numero: '4101', name: 'PH N-D', type: 'Coffrage', zone: 'Bloc 4' },
  { numero: '1102', name: 'PH N-D', type: 'Coupes', zone: 'Bloc 1' },
  { numero: '1302', name: 'ESC IV-1', type: 'Coupes', zone: 'Bloc 1' },
  { numero: '2102', name: 'PH N-D', type: 'Coupes', zone: 'Bloc 2' },
  { numero: '3102', name: 'PH N-D', type: 'Coupes', zone: 'Bloc 3' },
  { numero: '4102', name: 'PH N-D', type: 'Coupes', zone: 'Bloc 4' },
  { numero: '5101', name: 'PH N-D', type: 'Démolition', zone: 'Bloc 1-2' },
  { numero: '6101', name: 'PH N-D', type: 'Démolition', zone: 'Bloc 3-4' },
  { numero: '9001', name: 'Note de calcul', type: '', zone: '' },
];

const ENTRIES = RAW_DOCUMENTS.map((document, index) => ({
  key: index,
  searchKey: buildDocumentSearchKey(document),
  typeKey: typeKeyOf(document.type),
  typeLabel: document.type || 'Sans type',
  zoneKey: zoneKeyOf(document.zone),
  zoneLabel: document.zone || 'Sans zone',
}));

function visibleNumeros(filters) {
  const { visibleKeys } = computeDocumentFacets(ENTRIES, filters);
  return RAW_DOCUMENTS.filter((_document, index) => visibleKeys.has(index)).map((doc) => doc.numero);
}

function optionCount(options, value) {
  return options.find((option) => option.value === value)?.count;
}

test('la clé de recherche ne contient que le numéro et le nom, normalisés', () => {
  assert.equal(buildDocumentSearchKey({ numero: '1101', name: 'PH N-D' }), '1101 ph n-d');
  // Double espace dans la donnée : compressé, sinon « PH N-U » ne le trouverait jamais.
  assert.equal(buildDocumentSearchKey({ numero: '4011', name: 'PH  N-U' }), '4011 ph n-u');
  assert.equal(buildDocumentSearchKey({ numero: null, name: 'Démolition partielle' }), 'demolition partielle');
  assert.equal(buildDocumentSearchKey({}), '');
});

test('la recherche exige tous les mots, dans un ordre libre', () => {
  assert.equal(matchesDocumentSearch('1101 ph n-d', 'PH N-D'), true);
  assert.equal(matchesDocumentSearch('1101 ph n-d', 'N-D 1101'), true);
  assert.equal(matchesDocumentSearch('1101 ph n-d', '110'), true);
  assert.equal(matchesDocumentSearch('1101 ph n-d', 'PH N-E'), false);
  assert.equal(matchesDocumentSearch('1101 ph n-d', ''), true);
  assert.equal(matchesDocumentSearch('1101 ph n-d', '   '), true);
});

test('« PH N-D » remonte les dix documents, tous types et zones confondus', () => {
  assert.deepEqual(visibleNumeros({ query: 'PH N-D' }), [
    '1101', '2101', '3101', '4101',
    '1102', '2102', '3102', '4102',
    '5101', '6101',
  ]);
});

test('le type resserre la recherche, puis la zone la resserre encore', () => {
  assert.deepEqual(
    visibleNumeros({ query: 'PH N-D', type: 'coupes' }),
    ['1102', '2102', '3102', '4102']
  );
  assert.deepEqual(
    visibleNumeros({ query: 'PH N-D', type: 'coupes', zone: 'bloc2' }),
    ['2102']
  );
});

test('un double espace dans la donnée reste trouvable par une saisie normale', () => {
  assert.deepEqual(visibleNumeros({ query: 'PH N-U' }), ['1011', '2011', '4011']);
});

test('le type et la zone ne sont plus atteignables par la recherche', () => {
  // Le type existe bien dans les données mais la recherche ne le regarde pas :
  // c'est au menu Type de le filtrer.
  assert.deepEqual(visibleNumeros({ query: 'demolition' }), []);
  assert.deepEqual(visibleNumeros({ query: 'bloc 2' }), []);
  assert.deepEqual(
    visibleNumeros({ query: '', type: 'démolition' }),
    ['5101', '6101']
  );
});

test('une requête vide ou un filtre « tous » laisse tout visible', () => {
  assert.equal(computeDocumentFacets(ENTRIES, {}).visibleCount, RAW_DOCUMENTS.length);
  assert.equal(
    computeDocumentFacets(ENTRIES, { query: '', type: ALL_VALUE, zone: ALL_VALUE }).visibleCount,
    RAW_DOCUMENTS.length
  );
});

test('les documents sans type et sans zone se filtrent par leurs valeurs sentinelles', () => {
  assert.deepEqual(visibleNumeros({ type: NO_TYPE_VALUE }), ['9001']);
  assert.deepEqual(visibleNumeros({ zone: NO_ZONE_VALUE }), ['9001']);
});

test('le menu Type compte selon la requête et la zone actives, pas selon lui-même', () => {
  const { typeOptions } = computeDocumentFacets(ENTRIES, { query: 'PH N-D', type: 'coupes' });
  assert.equal(optionCount(typeOptions, ALL_VALUE), 10);
  assert.equal(optionCount(typeOptions, 'coffrage'), 4);
  assert.equal(optionCount(typeOptions, 'coupes'), 4);
  assert.equal(optionCount(typeOptions, 'démolition'), 2);
  // Un type absent de la recherche courante ne doit pas être proposé.
  assert.equal(optionCount(typeOptions, NO_TYPE_VALUE), undefined);
});

test('le menu Zone compte selon la requête et le type actifs, pas selon lui-même', () => {
  const { zoneOptions } = computeDocumentFacets(ENTRIES, { query: 'PH N-D', type: 'coupes', zone: 'bloc2' });
  assert.equal(optionCount(zoneOptions, ALL_VALUE), 4);
  assert.deepEqual(
    zoneOptions.map((option) => option.value),
    [ALL_VALUE, 'bloc1', 'bloc2', 'bloc3', 'bloc4']
  );
  zoneOptions.slice(1).forEach((option) => assert.equal(option.count, 1));
});

test('les libellés des options viennent des entrées, avec leur casse d’origine', () => {
  const { typeOptions, zoneOptions } = computeDocumentFacets(ENTRIES, {});
  assert.deepEqual(
    typeOptions.map((option) => option.label),
    ['Tous les types', 'Coffrage', 'Coupes', 'Démolition', 'Sans type']
  );
  assert.equal(zoneOptions.find((option) => option.value === 'bloc12')?.label, 'Bloc 1-2');
  assert.equal(zoneOptions.find((option) => option.value === NO_ZONE_VALUE)?.label, 'Sans zone');
});

test('les libellés « tous » sont personnalisables', () => {
  const { typeOptions, zoneOptions } = computeDocumentFacets(ENTRIES, {
    typeAllLabel: 'Tout',
    zoneAllLabel: 'Partout',
  });
  assert.equal(typeOptions[0].label, 'Tout');
  assert.equal(zoneOptions[0].label, 'Partout');
});

test('une sélection devenue introuvable reste proposée à zéro, le select ne se réinitialise pas seul', () => {
  const { typeOptions, zoneOptions, visibleCount } = computeDocumentFacets(ENTRIES, {
    query: 'PH N-D',
    type: NO_TYPE_VALUE,
    zone: 'bloc12',
  });
  assert.equal(visibleCount, 0);
  const orphanType = typeOptions.find((option) => option.value === NO_TYPE_VALUE);
  assert.deepEqual(orphanType, { value: NO_TYPE_VALUE, label: 'Sans type', count: 0 });
  const orphanZone = zoneOptions.find((option) => option.value === 'bloc12');
  assert.deepEqual(orphanZone, { value: 'bloc12', label: 'Bloc 1-2', count: 0 });
});

test('une liste vide ne casse rien', () => {
  const facets = computeDocumentFacets([], { query: 'PH N-D' });
  assert.equal(facets.visibleCount, 0);
  assert.equal(facets.visibleKeys.size, 0);
  assert.deepEqual(facets.typeOptions, [{ value: ALL_VALUE, label: 'Tous les types', count: 0 }]);
  assert.deepEqual(facets.zoneOptions, [{ value: ALL_VALUE, label: 'Toutes les zones', count: 0 }]);
});
