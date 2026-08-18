'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const utils = require('../js/edit-group-utils.js');

function makeRecord(overrides = {}) {
  return {
    id: 1,
    NomProjet: ' Projet Alpha ',
    NomDocument: 'Document A',
    NumeroDocument: '001',
    Type_document: 'NDC',
    Zone: 'Zone 1',
    Service: 'Structure',
    Emetteur: ' ARCHI ',
    Reference: ' Test2 ',
    Indice: ' A ',
    Recu: '03/08/2026',
    DureeLimite: 0,
    DescriptionObservations: ' Test3 ',
    Remarque: ' Conservatoire ',
    DateLimite: '2026-08-20',
    Retard: '4',
    Bloquant: false,
    Archive: false,
    ...overrides,
  };
}

function matchingOtherRecord(id = 2, overrides = {}) {
  return makeRecord({
    id,
    NomDocument: `Document ${String.fromCharCode(64 + id)}`,
    NumeroDocument: String(id).padStart(3, '0'),
    DateLimite: '2025-01-01',
    Retard: '999',
    Remarque: 'Officiel',
    Archive: true,
    ...overrides,
  });
}

test('une seule ligne identique d’un autre document est proposée', () => {
  const initial = makeRecord();
  const match = matchingOtherRecord();
  const result = utils.findMatchingOtherRows([initial, match], initial);
  assert.deepEqual(result.map((record) => record.id), [2]);
});

test('plusieurs lignes identiques sont proposées et conservent leurs identifiants Grist', () => {
  const initial = makeRecord();
  const result = utils.findMatchingOtherRows(
    [initial, matchingOtherRecord(2), matchingOtherRecord(3)],
    initial
  );
  assert.deepEqual(result.map((record) => record.id), [2, 3]);
});

test('aucune ligne identique produit une liste vide', () => {
  const initial = makeRecord();
  const result = utils.findMatchingOtherRows(
    [initial, matchingOtherRecord(2, { Reference: 'Autre référence' })],
    initial
  );
  assert.deepEqual(result, []);
});

test('une différence sur chacun des sept champs comparés exclut la ligne', async (t) => {
  const initial = makeRecord();
  const differences = {
    Emetteur: 'BET',
    Reference: 'Autre',
    Indice: 'B',
    Recu: '04/08/2026',
    DureeLimite: 1,
    Bloquant: true,
    DescriptionObservations: 'Autre description',
  };

  assert.deepEqual(Object.keys(differences), [...utils.COMPARISON_FIELDS]);

  for (const [field, value] of Object.entries(differences)) {
    await t.test(field, () => {
      const candidate = matchingOtherRecord(2, { [field]: value });
      assert.deepEqual(utils.findMatchingOtherRows([candidate], initial), []);
    });
  }
});

test('la remarque ne restreint pas les correspondances mais reste surveillée et propagée', () => {
  const initial = makeRecord({ Remarque: 'Conservatoire' });
  const candidate = matchingOtherRecord(2, { Remarque: 'Officiel' });
  assert.deepEqual(
    utils.findMatchingOtherRows([candidate], initial).map((record) => record.id),
    [2]
  );

  // Apparier n'est pas surveiller : la remarque reste dans la clé d'obsolescence,
  // sinon une remarque changée ailleurs serait écrasée sans avertissement.
  assert.equal(utils.getComparisonKey(candidate), utils.getComparisonKey(initial));
  assert.notEqual(utils.getStalenessKey(candidate), utils.getStalenessKey(initial));
  assert.deepEqual(
    [...utils.STALENESS_FIELDS],
    [...utils.COMPARISON_FIELDS, 'Remarque']
  );

  const [update] = utils.createPerTargetUpdates({
    targets: [candidate],
    sharedFields: { Remarque: 'Conservatoire' },
    durationWeeks: '',
    buildLimitFields: () => ({}),
    withComputedRetard: (fields) => fields,
  });
  assert.equal(update.fields.Remarque, 'Conservatoire');
});

test('DateLimite, Retard et les autres champs techniques ne participent pas à la comparaison', () => {
  const initial = makeRecord();
  const candidate = matchingOtherRecord(2, {
    DateLimite: '1900-01-01',
    Retard: '',
    Archive: !initial.Archive,
    Type_document: 'COFFRAGE',
    Zone: 'Zone 9',
  });
  assert.deepEqual(
    utils.findMatchingOtherRows([candidate], initial).map((record) => record.id),
    [2]
  );
});

test('les lignes du même document, d’un autre projet ou d’un autre service sont exclues', () => {
  const initial = makeRecord();
  const sameDocument = makeRecord({ id: 2 });
  const otherProject = matchingOtherRecord(3, { NomProjet: 'Projet Beta' });
  const otherService = matchingOtherRecord(4, { Service: 'Méthodes' });
  assert.deepEqual(
    utils.findMatchingOtherRows([sameDocument, otherProject, otherService], initial),
    []
  );
});

test('les textes, dates, valeurs vides, date sentinelle, durées nulles et booléens sont normalisés', () => {
  assert.equal(utils.normalizeText('  Test  '), 'Test');
  assert.equal(utils.normalizeDate('03/08/2026'), '2026-08-03');
  assert.equal(utils.normalizeDate('2026-08-03T00:00:00Z'), '2026-08-03');
  assert.equal(utils.normalizeDate('1900-01-01'), '');
  assert.equal(utils.normalizeDate(''), '');
  assert.equal(utils.normalizeDuration(0), '0');
  assert.equal(utils.normalizeDuration('0'), '0');
  assert.equal(utils.normalizeDuration('0.0'), '0');
  assert.equal(utils.normalizeBoolean(true), '1');
  assert.equal(utils.normalizeBoolean(1), '1');
  assert.equal(utils.normalizeBoolean(false), '');
  assert.equal(utils.normalizeBoolean(null), '');
  assert.equal(utils.normalizeBoolean(''), '');
  assert.equal(utils.normalizeBoolean('false'), '');
  assert.equal(utils.normalizeBoolean('0'), '');
  assert.equal(utils.normalizeRemarque(' Conservatoire '), 'Conservatoire');
  assert.equal(utils.normalizeRemarque('Autre chose'), '');

  const initial = makeRecord({ Recu: '2026-08-03', DureeLimite: '0' });
  const candidate = matchingOtherRecord(2, { Recu: '03/08/2026', DureeLimite: 0 });
  assert.equal(utils.getComparisonKey(candidate), utils.getComparisonKey(initial));

  const emptyDate = makeRecord({ Recu: '', NomDocument: 'Document X' });
  const sentinelDate = matchingOtherRecord(3, { Recu: '1900-01-01' });
  assert.equal(utils.getComparisonKey(emptyDate), utils.getComparisonKey(sentinelDate));
});

test('les mises à jour recalculent DateLimite et Retard avec l’identité de chaque document cible', () => {
  const targets = [
    matchingOtherRecord(2, { NumeroDocument: '101', Bloquant: false }),
    matchingOtherRecord(3, { NumeroDocument: '202', Bloquant: true }),
  ];
  const calls = [];
  const updates = utils.createPerTargetUpdates({
    targets,
    sharedFields: { Reference: 'Nouvelle référence', Recu: '2026-08-03' },
    durationWeeks: '0',
    planningTable: { marker: 'planning' },
    buildLimitFields(options) {
      calls.push(options);
      return {
        DureeLimite: 0,
        DateLimite: options.documentInfo.numero === '101' ? '2026-08-10' : '2026-08-17',
      };
    },
    withComputedRetard(fields) {
      return { ...fields, Retard: fields.DateLimite === '2026-08-10' ? '1' : '' };
    },
  });

  assert.deepEqual(updates.map(({ fields }) => fields.DateLimite), ['2026-08-10', '2026-08-17']);
  assert.deepEqual(updates.map(({ fields }) => fields.Retard), ['1', '']);
  assert.deepEqual(calls.map((call) => call.documentInfo.numero), ['101', '202']);
  assert.deepEqual(calls.map((call) => call.documentInfo.name), ['Document B', 'Document C']);
  assert.deepEqual(calls.map((call) => call.documentInfo.type), ['NDC', 'NDC']);
  assert.deepEqual(calls.map((call) => call.documentInfo.zone), ['Zone 1', 'Zone 1']);
  assert.deepEqual(calls.map((call) => call.service), ['Structure', 'Structure']);
  assert.deepEqual(calls.map((call) => call.useZeroWhenEmpty), [false, true]);
});

test('le bloquant du formulaire prime sur celui stocké dans chaque ligne cible', () => {
  const targets = [
    matchingOtherRecord(2, { Bloquant: false }),
    matchingOtherRecord(3, { Bloquant: true }),
  ];
  const calls = [];
  const run = (sharedFields) => {
    calls.length = 0;
    utils.createPerTargetUpdates({
      targets,
      sharedFields,
      durationWeeks: '',
      buildLimitFields(options) {
        calls.push(options);
        return {};
      },
      withComputedRetard: (fields) => fields,
    });
    return calls.map((call) => call.useZeroWhenEmpty);
  };

  assert.deepEqual(run({ Bloquant: true }), [true, true]);
  assert.deepEqual(run({ Bloquant: false }), [false, false]);
  assert.deepEqual(run({}), [false, true]);
});

test('la ligne courante reste la seule cible sans sélection groupée', () => {
  assert.deepEqual(utils.getTargetRecordIds(1, []), [1]);
  assert.deepEqual(utils.buildUpdateActions([
    { target: { id: 1 }, fields: { Reference: 'R2' } },
  ]), [
    ['UpdateRecord', 'References2', 1, { Reference: 'R2' }],
  ]);
});

test('la modification et la suppression groupées utilisent seulement les identifiants sélectionnés', () => {
  assert.deepEqual(utils.getTargetRecordIds(1, [2, 3, 2, 0, '']), [1, 2, 3]);
  assert.deepEqual(utils.buildRemoveActions([1, 2, 3, 2]), [
    ['RemoveRecord', 'References2', 1],
    ['RemoveRecord', 'References2', 2],
    ['RemoveRecord', 'References2', 3],
  ]);
});

test('les doublons potentiels sont détectés avant la construction du lot', () => {
  const identity = (record) => [record.NomDocument, record.Reference, record.Indice].join('|');
  const target = makeRecord({ id: 1, Reference: 'R1' });
  const existing = makeRecord({ id: 9, Reference: 'R2' });
  const existingConflict = utils.findUpdateDuplicateConflict(
    [target, existing],
    [{ target, fields: { Reference: 'R2' } }],
    { getIdentity: identity }
  );
  assert.equal(existingConflict.type, 'existing-record');
  assert.equal(existingConflict.conflict.id, 9);

  const secondTarget = makeRecord({ id: 2, Reference: 'R3' });
  const selectedConflict = utils.findUpdateDuplicateConflict(
    [target, secondTarget],
    [
      { target, fields: { Reference: 'R4' } },
      { target: secondTarget, fields: { Reference: 'R4' } },
    ],
    { getIdentity: identity }
  );
  assert.equal(selectedConflict.type, 'selected-targets');

  const archived = makeRecord({ id: 10, Reference: 'R5', Archive: true });
  assert.equal(utils.findUpdateDuplicateConflict(
    [target, archived],
    [{ target, fields: { Reference: 'R5' } }],
    { getIdentity: identity }
  ), null);
});

test('la conversion de table Grist conserve les identifiants de lignes', () => {
  assert.deepEqual(utils.tableToRows({
    id: [10, 11],
    NomDocument: ['A', 'B'],
    Reference: ['R1', 'R2'],
  }), [
    { id: 10, NomDocument: 'A', Reference: 'R1' },
    { id: 11, NomDocument: 'B', Reference: 'R2' },
  ]);
});
