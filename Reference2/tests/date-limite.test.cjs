'use strict';

// Les dates dépendent du fuseau : on fige celui du chantier.
process.env.TZ = 'Europe/Paris';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadLegacyFunctions } = require('./legacy-source.cjs');

const {
  computeReferenceDateLimiteIso,
  buildReferenceDateLimiteSyncEntries,
  describeReferenceDateLimite,
} = loadLegacyFunctions(
  [
    '_norm',
    'normalizeServiceMatchKey',
    'normalizeZoneValue',
    'normalizeZoneMatchKey',
    'normalizeTypeDocument',
    'hasPlanningColumn',
    'getPlanningProjectColumn',
    'getPlanningTaskColumn',
    'findPlanningIndex',
    'getPlanningRowObject',
    'findPlanningRowForReferenceLimit',
    'isReferenceArmaturesTypeDoc',
    'getReferencePlanningSegmentStartDate',
    'parseReferenceRetardCalendarDate',
    'isEmptyReferenceRetardDate',
    'formatReferenceDateIso',
    'parseReferenceDurationLimit',
    'subtractReferenceWeeksFromDate',
    'describeReferenceDateLimite',
    'computeReferenceDateLimiteIso',
    'buildReferenceDateLimiteSyncEntries',
  ],
  { window: {}, rememberReferenceDateLimiteDescription() {} }
);

// Une date Grist est un nombre de secondes à minuit UTC.
const seconds = (year, month, day) => Date.UTC(year, month - 1, day) / 1000;

// Trois lignes de planning :
//  1. coffrage au début renseigné (22/12/2025) ;
//  2. armatures au début renseigné (15/09/2026) ;
//  3. coffrage sans début : segment [? -> 19/01/2027] de 1 semaine, donc départ
//     réel au 12/01/2027.
const PLANNING = {
  id: [1, 2, 3],
  NomProjet: ['Test2', 'Test2', 'Test2'],
  ID2: ['140', '011', '3021'],
  Type_doc: ['COFFRAGE', 'ARMATURES', 'COFFRAGE'],
  Zone: ['Zone A', 'Zone A', 'Zone A'],
  Taches: ['R+4 PH', 'RDC Dalles', 'PH 1er SOUS-SOL - COF'],
  Service: ['Structure', 'Structure', 'Structure'],
  Date_limite: [seconds(2025, 12, 22), null, null],
  Diff_coffrage: [null, seconds(2026, 9, 15), seconds(2027, 1, 19)],
  Diff_armature: [null, null, null],
  Duree_1: [2, null, 1],
  Duree_2: [null, 3, null],
  Demarrages_travaux: [null, null, seconds(2027, 2, 1)],
};

function coffrageRecord(overrides = {}) {
  return {
    id: 10,
    NomProjet: 'Test2',
    NumeroDocument: '140',
    NomDocument: 'R+4 PH',
    Type_document: 'COFFRAGE',
    Zone: 'Zone A',
    Service: 'Structure',
    DureeLimite: 3,
    Bloquant: true,
    DateLimite: seconds(2025, 12, 1),
    ...overrides,
  };
}

test('la date limite est l ancre du planning moins la duree en semaines', () => {
  assert.equal(computeReferenceDateLimiteIso(PLANNING, coffrageRecord()), '2025-12-01');
  assert.equal(
    computeReferenceDateLimiteIso(PLANNING, coffrageRecord({ DureeLimite: 5 })),
    '2025-11-17'
  );
  assert.equal(
    computeReferenceDateLimiteIso(PLANNING, coffrageRecord({ DureeLimite: 0 })),
    '2025-12-22'
  );
});

test('un document ARMATURES s ancre sur le debut de coffrage', () => {
  const record = coffrageRecord({
    NumeroDocument: '011',
    NomDocument: 'RDC Dalles',
    Type_document: 'ARMATURES',
  });
  assert.equal(computeReferenceDateLimiteIso(PLANNING, record), '2026-08-25');
});

test('une ligne bloquante sans duree vaut zero semaine, sinon aucune date', () => {
  assert.equal(
    computeReferenceDateLimiteIso(PLANNING, coffrageRecord({ DureeLimite: '', Bloquant: true })),
    '2025-12-22'
  );
  assert.equal(
    computeReferenceDateLimiteIso(PLANNING, coffrageRecord({ DureeLimite: '', Bloquant: false })),
    ''
  );
});

test('un debut de segment absent se reconstruit depuis la fin moins sa duree', () => {
  // Segment [? -> 19/01/2027] de 1 semaine : le départ est le 12/01/2027, pas le
  // 19/01. Prendre la fin telle quelle décalerait toutes les dates d'une semaine.
  const record = coffrageRecord({
    NumeroDocument: '3021',
    NomDocument: 'PH 1er SOUS-SOL - COF',
    DateLimite: null,
  });

  assert.equal(
    describeReferenceDateLimite(PLANNING, record).anchorIso,
    '2027-01-12'
  );
  assert.equal(
    computeReferenceDateLimiteIso(PLANNING, { ...record, DureeLimite: 1 }),
    '2027-01-05'
  );
  assert.equal(
    computeReferenceDateLimiteIso(PLANNING, { ...record, DureeLimite: 2 }),
    '2026-12-29'
  );
});

test('le service fait partie de la cle du planning', () => {
  assert.equal(
    computeReferenceDateLimiteIso(PLANNING, coffrageRecord({ Service: 'Synthese' })),
    ''
  );
});

test('une date deja synchronisee ne declenche aucune ecriture', () => {
  assert.deepEqual(buildReferenceDateLimiteSyncEntries(PLANNING, [coffrageRecord()]), []);
});

test('une date desynchronisee de la duree est corrigee', () => {
  // Durée passée à 5 semaines alors que la date stockée vaut encore 3 semaines.
  const record = coffrageRecord({ DureeLimite: 5 });
  const entries = buildReferenceDateLimiteSyncEntries(PLANNING, [record]);

  assert.equal(entries.length, 1);
  assert.equal(entries[0].recordId, 10);
  assert.equal(entries[0].dateLimite, '2025-11-17');
  assert.equal(entries[0].record, record);
});

test('sans ancre exploitable la date existante est laissee intacte', () => {
  const introuvable = coffrageRecord({ NumeroDocument: '999' });
  assert.deepEqual(buildReferenceDateLimiteSyncEntries(PLANNING, [introuvable]), []);
  assert.deepEqual(buildReferenceDateLimiteSyncEntries(null, [coffrageRecord({ DureeLimite: 5 })]), []);
});
