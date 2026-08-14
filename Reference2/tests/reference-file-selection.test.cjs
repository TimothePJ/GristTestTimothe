'use strict';

// La date lue sur le fichier dépend du fuseau : on fige celui du chantier, sinon
// « 12 mars 00h30 à Paris » se lirait « 11 mars » en UTC.
process.env.TZ = 'Europe/Paris';

const test = require('node:test');
const assert = require('node:assert/strict');
const { extractConst, loadLegacyFunctions } = require('./legacy-source.cjs');

const REFERENCE_ROW_FORM_CONFIG = extractConst('REFERENCE_ROW_FORM_CONFIG');
const REFERENCE_PENDING_DESCRIPTION = extractConst('REFERENCE_PENDING_DESCRIPTION');
const REFERENCE_FILE_DESCRIPTION = extractConst('REFERENCE_FILE_DESCRIPTION');

// `clearReferenceFieldError` filtre sur `instanceof HTMLElement` : le bac à sable doit
// donc fournir la classe et des éléments qui en héritent.
class HTMLElement {
  constructor(id) {
    this.id = id;
    this.value = '';
    this.hidden = false;
    this.textContent = '';
    this.classList = { remove() {}, add() {} };
  }

  removeAttribute() {}

  setAttribute() {}

  closest() {
    return null;
  }
}

function createFileInput(id) {
  const input = new HTMLElement(id);
  input.files = [];
  return input;
}

function setup(mode, { fileFields = {} } = {}) {
  const config = REFERENCE_ROW_FORM_CONFIG[mode];
  const registry = {};
  Object.values(config.fields).forEach((fieldId) => {
    registry[fieldId] = new HTMLElement(fieldId);
  });
  registry[config.fileId] = createFileInput(config.fileId);
  registry[config.fileStatusId] = new HTMLElement(config.fileStatusId);
  registry[config.fileClearId] = new HTMLElement(config.fileClearId);
  registry[config.fileClearId].hidden = true;

  const documentStub = {
    getElementById: (id) => registry[id] || null,
    createElement: () => new HTMLElement(''),
  };

  const calls = { updateEditSubmitState: 0, updateDuplicateSelectionSummary: 0 };
  const glue = loadLegacyFunctions([
    'normalizeReferenceDocumentIdentityPart',
    'parseReferenceRetardCalendarDate',
    'isEmptyReferenceRetardDate',
    'formatReferenceDateIso',
    'formatReferenceTableDate',
    'removeFileExtension',
    'clearReferenceFieldError',
    'getReferenceRowFormConfig',
    'getReferenceRowField',
    'resetReferenceFilePicker',
    'getReferenceFileReceivedDateIso',
    'shouldReplaceReferenceDescription',
    'applyReferenceFileSelection',
  ], {
    document: documentStub,
    HTMLElement,
    REFERENCE_ROW_FORM_CONFIG,
    REFERENCE_PENDING_DESCRIPTION,
    REFERENCE_FILE_DESCRIPTION,
    updateEditSubmitState: () => { calls.updateEditSubmitState += 1; },
    updateDuplicateSelectionSummary: () => { calls.updateDuplicateSelectionSummary += 1; },
  });

  Object.assign(registry, fileFields);

  return {
    calls,
    config,
    glue,
    registry,
    field: (name) => registry[config.fields[name]],
    selectFile: (file) => {
      registry[config.fileId].files = file ? [file] : [];
      glue.applyReferenceFileSelection(mode);
    },
  };
}

// 12/03/2026 à 00h30, heure de Paris : 11/03 23h30 en UTC. Un formatage naïf via
// toISOString() renverrait la veille.
const PARIS_MIDNIGHT_TIMESTAMP = new Date(2026, 2, 12, 0, 30).getTime();

test('la date du fichier est lue en calendrier local, pas en UTC', () => {
  const { glue } = setup('add');
  assert.equal(
    glue.getReferenceFileReceivedDateIso({ lastModified: PARIS_MIDNIGHT_TIMESTAMP }),
    '2026-03-12'
  );
});

test('un fichier antérieur à mars 1973 garde sa vraie date', () => {
  // Sous ce seuil, l'horodatage en millisecondes passe sous 1e11 : lu en nombre par
  // l'analyseur commun, il serait pris pour des secondes et projeté en 3970.
  const { glue } = setup('add');
  assert.equal(
    glue.getReferenceFileReceivedDateIso({ lastModified: new Date(1971, 5, 9, 12).getTime() }),
    '1971-06-09'
  );
});

test('un horodatage inexploitable ne produit aucune date', () => {
  const { glue } = setup('add');
  assert.equal(glue.getReferenceFileReceivedDateIso({ lastModified: 0 }), '');
  assert.equal(glue.getReferenceFileReceivedDateIso({ lastModified: -1 }), '');
  assert.equal(glue.getReferenceFileReceivedDateIso({ lastModified: NaN }), '');
  assert.equal(glue.getReferenceFileReceivedDateIso({}), '');
  assert.equal(glue.getReferenceFileReceivedDateIso(null), '');
});

test('seule une description vide ou en attente laisse la place', () => {
  const { glue } = setup('add');
  assert.equal(glue.shouldReplaceReferenceDescription(''), true);
  assert.equal(glue.shouldReplaceReferenceDescription('   '), true);
  assert.equal(glue.shouldReplaceReferenceDescription(null), true);
  assert.equal(glue.shouldReplaceReferenceDescription(REFERENCE_PENDING_DESCRIPTION), true);
  assert.equal(glue.shouldReplaceReferenceDescription('  en attente '), true);
  assert.equal(glue.shouldReplaceReferenceDescription('Reçu par courrier le 3 mars'), false);
  assert.equal(glue.shouldReplaceReferenceDescription(REFERENCE_FILE_DESCRIPTION), false);
});

test('choisir un fichier remplit la référence, la date reçue et la description', () => {
  const dialog = setup('add');
  dialog.selectFile({ name: 'PLAN-4521-B.pdf', lastModified: PARIS_MIDNIGHT_TIMESTAMP });

  assert.equal(dialog.field('reference').value, 'PLAN-4521-B');
  assert.equal(dialog.field('recu').value, '2026-03-12');
  assert.equal(dialog.field('description').value, REFERENCE_FILE_DESCRIPTION);
});

test('la date reçue est toujours reprise du fichier, même déjà renseignée', () => {
  const dialog = setup('edit');
  dialog.field('recu').value = '2020-01-01';
  dialog.selectFile({ name: 'NOTE-12.pdf', lastModified: PARIS_MIDNIGHT_TIMESTAMP });

  assert.equal(dialog.field('recu').value, '2026-03-12');
});

test('une description rédigée à la main est préservée', () => {
  const dialog = setup('edit');
  dialog.field('description').value = 'Reçu par courrier, plan incomplet';
  dialog.selectFile({ name: 'NOTE-12.pdf', lastModified: PARIS_MIDNIGHT_TIMESTAMP });

  assert.equal(dialog.field('description').value, 'Reçu par courrier, plan incomplet');
  assert.equal(dialog.field('recu').value, '2026-03-12');
});

test('la description par défaut « en attente » bascule sur « pris en compte »', () => {
  const dialog = setup('edit');
  dialog.field('description').value = REFERENCE_PENDING_DESCRIPTION;
  dialog.selectFile({ name: 'NOTE-12.pdf', lastModified: PARIS_MIDNIGHT_TIMESTAMP });

  assert.equal(dialog.field('description').value, REFERENCE_FILE_DESCRIPTION);
});

test('un fichier sans date exploitable laisse la date reçue intacte', () => {
  const dialog = setup('add');
  dialog.field('recu').value = '2026-01-05';
  dialog.selectFile({ name: 'SANS-DATE.pdf', lastModified: 0 });

  assert.equal(dialog.field('reference').value, 'SANS-DATE');
  assert.equal(dialog.field('recu').value, '2026-01-05');
  assert.equal(dialog.field('description').value, REFERENCE_FILE_DESCRIPTION);
  assert.match(dialog.registry.referenceFileStatus.textContent, /Date du fichier indisponible/);
});

test('le statut affiche le fichier, la référence et la date retenue', () => {
  const dialog = setup('add');
  dialog.selectFile({ name: 'PLAN-4521-B.pdf', lastModified: PARIS_MIDNIGHT_TIMESTAMP });

  assert.equal(
    dialog.registry.referenceFileStatus.textContent,
    'Fichier : PLAN-4521-B.pdf · Référence : PLAN-4521-B · Reçu : 12/03/2026'
  );
  assert.equal(dialog.registry.clearReferenceFileButton.hidden, false);
});

test('retirer le fichier remet le sélecteur à zéro sans toucher aux champs remplis', () => {
  const dialog = setup('edit');
  dialog.selectFile({ name: 'NOTE-12.pdf', lastModified: PARIS_MIDNIGHT_TIMESTAMP });
  dialog.glue.resetReferenceFilePicker('edit');

  assert.equal(dialog.field('reference').value, 'NOTE-12');
  assert.equal(dialog.field('recu').value, '2026-03-12');
  assert.equal(dialog.field('description').value, REFERENCE_FILE_DESCRIPTION);
  assert.equal(dialog.registry.editReferenceFile.value, '');
  assert.equal(dialog.registry.clearEditReferenceFileButton.hidden, true);
});

test('chaque mode prévient son propre rafraîchissement de formulaire', () => {
  const addDialog = setup('add');
  addDialog.selectFile({ name: 'A.pdf', lastModified: PARIS_MIDNIGHT_TIMESTAMP });
  assert.equal(addDialog.calls.updateDuplicateSelectionSummary, 1);
  assert.equal(addDialog.calls.updateEditSubmitState, 0);

  const editDialog = setup('edit');
  editDialog.selectFile({ name: 'B.pdf', lastModified: PARIS_MIDNIGHT_TIMESTAMP });
  assert.equal(editDialog.calls.updateEditSubmitState, 1);
  assert.equal(editDialog.calls.updateDuplicateSelectionSummary, 0);
});
