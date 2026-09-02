'use strict';

// Le câblage DOM de la barre de filtres est extrait de legacy.js et exécuté contre
// un DOM minimal : c'est la seule façon de vérifier, sans navigateur, que le markup
// des listes et le moteur de filtrage parlent bien le même langage.

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadLegacyFunctions } = require('./legacy-source.cjs');
const documentFilterUtils = require('../js/document-filter-utils.js');

const LEGACY_FUNCTION_NAMES = [
  'escapeHtml',
  'normalizeReferenceDocumentIdentityPart',
  'normalizeTypeDocument',
  'normalizeZoneValue',
  'normalizeZoneMatchKey',
  'formatZoneLabel',
  'getReferenceDocumentFilterUtils',
  'buildReferenceDocumentItemAttributes',
  'buildReferenceDocumentFilterToolbarMarkup',
  'collectReferenceDocumentFilterEntries',
  'renderReferenceDocumentFilterOptions',
  'applyReferenceDocumentListFilters',
];

function createNode(className, dataset = {}) {
  return {
    className,
    dataset,
    hidden: false,
    descendants: [],
    querySelectorAll(selector) {
      const wanted = selector.replace('.', '');
      return this.descendants.filter((node) => node.className.split(' ').includes(wanted));
    },
  };
}

function createSelect() {
  return {
    value: '',
    children: [],
    replaceChildren(...nodes) {
      this.children = nodes;
    },
  };
}

// Reconstruit la hiérarchie type → zone → document produite par les deux dialogues.
function createDom(documents, { attributesOf, withZoneSelect = true }) {
  const container = createNode('container');
  const typeGroups = new Map();

  documents.forEach((document_) => {
    const attributes = attributesOf(document_);
    const item = createNode('emetteur-item duplicate-document-item', attributes);
    const typeKey = attributes.docType;
    if (!typeGroups.has(typeKey)) {
      const typeGroup = createNode('duplicate-document-group');
      typeGroups.set(typeKey, { node: typeGroup, zones: new Map() });
      container.descendants.push(typeGroup);
    }
    const typeGroup = typeGroups.get(typeKey);
    if (!typeGroup.zones.has(attributes.docZone)) {
      const zoneGroup = createNode('duplicate-zone-group');
      typeGroup.zones.set(attributes.docZone, zoneGroup);
      typeGroup.node.descendants.push(zoneGroup);
      container.descendants.push(zoneGroup);
    }
    const zoneGroup = typeGroup.zones.get(attributes.docZone);
    zoneGroup.descendants.push(item);
    typeGroup.node.descendants.push(item);
    container.descendants.push(item);
  });

  const registry = {
    testContainer: container,
    testSearch: { value: '' },
    testTypeFilter: createSelect(),
    testSearchEmpty: { hidden: true },
  };
  if (withZoneSelect) registry.testZoneFilter = createSelect();

  return {
    container,
    registry,
    documentStub: {
      getElementById: (id) => registry[id] || null,
      createElement: () => ({ value: '', textContent: '' }),
    },
  };
}

// Parse la chaîne d'attributs produite par buildReferenceDocumentItemAttributes vers
// l'objet dataset que le navigateur exposerait.
function parseAttributes(markup) {
  const dataset = {};
  const pattern = /data-([a-z-]+)="([^"]*)"/g;
  let match = pattern.exec(markup);
  while (match) {
    const camelKey = match[1].replace(/-([a-z])/g, (_full, letter) => letter.toUpperCase());
    dataset[camelKey] = match[2];
    match = pattern.exec(markup);
  }
  return dataset;
}

const DOCUMENTS = [
  { numero: '1101', name: 'PH N-D', type: 'Coffrage', zone: 'Bloc 1' },
  { numero: '2101', name: 'PH N-D', type: 'Coffrage', zone: 'Bloc 2' },
  { numero: '1011', name: 'PH N-U', type: 'Coffrage', zone: 'Bloc 1' },
  { numero: '1102', name: 'PH N-D', type: 'Coupes', zone: 'Bloc 1' },
  { numero: '2102', name: 'PH N-D', type: 'Coupes', zone: 'Bloc 2' },
  { numero: '5101', name: 'PH N-D', type: 'Démolition', zone: 'Bloc 1-2' },
];

function loadGlue(documentStub) {
  return loadLegacyFunctions(LEGACY_FUNCTION_NAMES, {
    window: { ReferenceDocumentFilterUtils: documentFilterUtils },
    document: documentStub,
    REFERENCE_DOC_FILTER_ALL_VALUE: documentFilterUtils.ALL_VALUE,
    REFERENCE_DOC_FILTER_NO_TYPE: documentFilterUtils.NO_TYPE_VALUE,
    REFERENCE_DOC_FILTER_NO_ZONE: documentFilterUtils.NO_ZONE_VALUE,
  });
}

function setup({ withZoneSelect = true } = {}) {
  const bootstrap = loadGlue({ getElementById: () => null, createElement: () => ({}) });
  const dom = createDom(DOCUMENTS, {
    attributesOf: (document_) => parseAttributes(bootstrap.buildReferenceDocumentItemAttributes(document_)),
    withZoneSelect,
  });
  return { ...dom, glue: loadGlue(dom.documentStub) };
}

function visibleNumeros(container) {
  return container
    .querySelectorAll('.duplicate-document-item')
    .filter((item) => !item.hidden)
    .map((item) => item.dataset.docSearch.split(' ')[0]);
}

test('les attributs de filtrage portent la recherche, les clés et les libellés', () => {
  const { buildReferenceDocumentItemAttributes } = loadGlue({ getElementById: () => null });
  const dataset = parseAttributes(buildReferenceDocumentItemAttributes({
    numero: '5101',
    name: 'PH N-D',
    type: 'Démolition',
    zone: 'Bloc 1-2',
  }));

  assert.deepEqual(dataset, {
    docSearch: '5101 ph n-d',
    docType: 'démolition',
    docTypeLabel: 'DÉMOLITION',
    docZone: 'bloc12',
    docZoneLabel: 'Bloc 1-2',
  });
});

test('un document sans type ni zone reçoit les valeurs sentinelles', () => {
  const { buildReferenceDocumentItemAttributes } = loadGlue({ getElementById: () => null });
  const dataset = parseAttributes(buildReferenceDocumentItemAttributes({
    numero: '9001',
    name: 'Note de calcul',
  }));

  assert.equal(dataset.docType, documentFilterUtils.NO_TYPE_VALUE);
  assert.equal(dataset.docZone, documentFilterUtils.NO_ZONE_VALUE);
  assert.equal(dataset.docTypeLabel, 'Sans type');
  assert.equal(dataset.docZoneLabel, 'Sans zone');
});

test('la barre rend trois contrôles, ou deux quand le projet n’a pas de zone', () => {
  const { buildReferenceDocumentFilterToolbarMarkup } = loadGlue({ getElementById: () => null });

  const withZone = buildReferenceDocumentFilterToolbarMarkup('duplicate', { showZoneFilter: true });
  assert.ok(withZone.includes('id="duplicateSearch"'));
  assert.ok(withZone.includes('id="duplicateTypeFilter"'));
  assert.ok(withZone.includes('id="duplicateZoneFilter"'));

  const withoutZone = buildReferenceDocumentFilterToolbarMarkup('duplicate', { showZoneFilter: false });
  assert.ok(withoutZone.includes('id="duplicateTypeFilter"'));
  assert.ok(!withoutZone.includes('id="duplicateZoneFilter"'));
});

test('la recherche masque les documents et les groupes qu’elle vide', () => {
  const { container, registry, glue } = setup();
  registry.testSearch.value = 'PH N-D';
  glue.applyReferenceDocumentListFilters('test', 'testContainer');

  assert.deepEqual(visibleNumeros(container), ['1101', '2101', '1102', '2102', '5101']);
  // Seul « 1011 PH N-U » disparaît, et son groupe garde 1101 : aucun titre ne tombe.
  const groups = container.querySelectorAll('.duplicate-document-group');
  assert.deepEqual(groups.map((group) => group.hidden), [false, false, false]);
});

test('un groupe entièrement filtré se masque avec son titre', () => {
  const { container, registry, glue } = setup();
  registry.testSearch.value = 'PH N-U';
  glue.applyReferenceDocumentListFilters('test', 'testContainer');

  assert.deepEqual(visibleNumeros(container), ['1011']);
  const typeGroups = container.querySelectorAll('.duplicate-document-group');
  assert.deepEqual(typeGroups.map((group) => group.hidden), [false, true, true]);
  // Seul Coffrage/Bloc 1 garde un document visible ; les quatre autres se masquent.
  const zoneGroups = container.querySelectorAll('.duplicate-zone-group');
  assert.deepEqual(zoneGroups.map((group) => group.hidden), [false, true, true, true, true]);
});

test('les trois filtres se composent', () => {
  const { container, registry, glue } = setup();
  registry.testSearch.value = 'PH N-D';
  registry.testTypeFilter.value = 'coupes';
  glue.applyReferenceDocumentListFilters('test', 'testContainer');
  assert.deepEqual(visibleNumeros(container), ['1102', '2102']);

  registry.testZoneFilter.value = 'bloc2';
  glue.applyReferenceDocumentListFilters('test', 'testContainer');
  assert.deepEqual(visibleNumeros(container), ['2102']);
});

test('les menus se remplissent avec leurs compteurs et conservent la valeur demandée', () => {
  const { registry, glue } = setup();
  registry.testSearch.value = 'PH N-D';
  registry.testTypeFilter.value = 'coupes';
  glue.applyReferenceDocumentListFilters('test', 'testContainer');

  assert.deepEqual(
    registry.testTypeFilter.children.map((option) => option.textContent),
    ['Tous les types (5)', 'COFFRAGE (2)', 'COUPES (2)', 'DÉMOLITION (1)']
  );
  assert.equal(registry.testTypeFilter.value, 'coupes');
  // Le menu Zone ne propose que les zones des COUPES restantes.
  assert.deepEqual(
    registry.testZoneFilter.children.map((option) => option.textContent),
    ['Toutes les zones (2)', 'Bloc 1 (1)', 'Bloc 2 (1)']
  );
  assert.equal(registry.testZoneFilter.value, documentFilterUtils.ALL_VALUE);
});

test('le pré-remplissage prime sur la valeur courante du menu, une seule fois', () => {
  const { container, registry, glue } = setup();
  registry.testTypeFilter.value = documentFilterUtils.ALL_VALUE;
  glue.applyReferenceDocumentListFilters('test', 'testContainer', {
    preferredType: 'coffrage',
    preferredZone: 'bloc1',
  });

  assert.deepEqual(visibleNumeros(container), ['1101', '1011']);
  assert.equal(registry.testTypeFilter.value, 'coffrage');
  assert.equal(registry.testZoneFilter.value, 'bloc1');

  // Passage suivant sans pré-remplissage : les menus gardent leur valeur.
  glue.applyReferenceDocumentListFilters('test', 'testContainer');
  assert.deepEqual(visibleNumeros(container), ['1101', '1011']);
});

test('le message « aucun résultat » suit le nombre de documents visibles', () => {
  const { registry, glue } = setup();
  glue.applyReferenceDocumentListFilters('test', 'testContainer');
  assert.equal(registry.testSearchEmpty.hidden, true);

  registry.testSearch.value = 'PH N-Z';
  glue.applyReferenceDocumentListFilters('test', 'testContainer');
  assert.equal(registry.testSearchEmpty.hidden, false);
});

test('sans menu Zone rendu, les deux autres filtres fonctionnent quand même', () => {
  const { container, registry, glue } = setup({ withZoneSelect: false });
  registry.testSearch.value = 'PH N-D';
  registry.testTypeFilter.value = 'démolition';
  glue.applyReferenceDocumentListFilters('test', 'testContainer');

  assert.deepEqual(visibleNumeros(container), ['5101']);
});

test('le callback de fin de filtrage est appelé à chaque passage', () => {
  const { glue } = setup();
  let calls = 0;
  glue.applyReferenceDocumentListFilters('test', 'testContainer', {
    onAfterFilter: () => { calls += 1; },
  });
  glue.applyReferenceDocumentListFilters('test', 'testContainer', {
    onAfterFilter: () => { calls += 1; },
  });
  assert.equal(calls, 2);
});

test('un conteneur inconnu ne casse rien', () => {
  const { glue } = setup();
  assert.doesNotThrow(() => glue.applyReferenceDocumentListFilters('test', 'inexistant'));
});
