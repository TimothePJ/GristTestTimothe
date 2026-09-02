'use strict';

// La durée limite n'appartient qu'aux lignes bloquantes. On vérifie ici les trois
// conséquences : elle ne s'affiche pas, elle ne se valide pas et elle ne se lit pas
// tant que la case n'est pas cochée.

const test = require('node:test');
const assert = require('node:assert/strict');
const { extractConst, loadLegacyFunctions } = require('./legacy-source.cjs');

const REFERENCE_ROW_FORM_CONFIG = extractConst('REFERENCE_ROW_FORM_CONFIG');

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

  focus() {}

  closest() {
    return null;
  }

  querySelector() {
    return null;
  }

  querySelectorAll() {
    return [];
  }
}

class HTMLInputElement extends HTMLElement {
  constructor(id, type = 'text') {
    super(id);
    this.type = type;
    this.checked = false;
  }
}

function setup(mode) {
  const config = REFERENCE_ROW_FORM_CONFIG[mode];
  const registry = {};
  Object.entries(config.fields).forEach(([name, fieldId]) => {
    registry[fieldId] = name === 'bloquant'
      ? new HTMLInputElement(fieldId, 'checkbox')
      : new HTMLInputElement(fieldId);
  });
  registry[config.durationFieldId] = new HTMLElement(config.durationFieldId);
  registry[config.dialogId] = new HTMLElement(config.dialogId);
  registry[config.statusId] = new HTMLElement(config.statusId);

  const documentStub = {
    getElementById: (id) => registry[id] || null,
    createElement: () => new HTMLElement(''),
  };

  const glue = loadLegacyFunctions([
    'getReferenceRowFormConfig',
    'getReferenceRowForm',
    'getReferenceRowField',
    'isReferenceRowBloquant',
    'syncReferenceRowBloquantUi',
    'getReferenceRowDurationValue',
    'applyReferenceRowBloquantValue',
    'isReferenceDefaultDurationBloquant',
    'isReferenceRecordBloquant',
    'getReferenceFormSnapshot',
    'clearReferenceFieldError',
    'setReferenceFieldError',
    'clearReferenceFormErrors',
    'parseReferenceDurationLimit',
    'validateReferenceRowForm',
  ], {
    document: documentStub,
    HTMLElement,
    HTMLInputElement,
    REFERENCE_ROW_FORM_CONFIG,
    setReferenceFormStatus: () => {},
  });

  const field = (name) => registry[config.fields[name]];

  // Les champs obligatoires sont remplis : seule la durée limite doit pouvoir
  // faire échouer la validation dans ces tests.
  ['emetteur', 'reference', 'indice', 'description', 'remarque'].forEach((name) => {
    field(name).value = 'valeur';
  });

  return {
    config,
    field,
    glue,
    durationField: registry[config.durationFieldId],
    setBloquant: (checked) => {
      field('bloquant').checked = checked;
      return glue.syncReferenceRowBloquantUi(mode);
    },
  };
}

for (const mode of ['add', 'edit']) {
  test(`[${mode}] la durée limite reste masquée tant que la ligne n'est pas bloquante`, () => {
    const dialog = setup(mode);

    assert.equal(dialog.glue.syncReferenceRowBloquantUi(mode), false);
    assert.equal(dialog.durationField.hidden, true);

    assert.equal(dialog.setBloquant(true), true);
    assert.equal(dialog.durationField.hidden, false);

    dialog.setBloquant(false);
    assert.equal(dialog.durationField.hidden, true);
  });

  test(`[${mode}] une durée saisie puis masquée n'est plus lue`, () => {
    const dialog = setup(mode);
    dialog.setBloquant(true);
    dialog.field('dureeLimite').value = '3';
    assert.equal(dialog.glue.getReferenceRowDurationValue(mode), '3');

    // La case décochée sans vider le champ : le formulaire ne doit pas repartir
    // en base avec une durée que l'utilisateur ne voit plus.
    dialog.setBloquant(false);
    assert.equal(dialog.glue.getReferenceRowDurationValue(mode), '');
  });

  test(`[${mode}] une durée invalide n'est signalée que sur une ligne bloquante`, () => {
    const dialog = setup(mode);
    dialog.field('dureeLimite').value = '-2';

    dialog.setBloquant(false);
    assert.equal(dialog.glue.validateReferenceRowForm(mode, { focus: false }), true);

    dialog.setBloquant(true);
    assert.equal(dialog.glue.validateReferenceRowForm(mode, { focus: false }), false);
  });

  test(`[${mode}] l'état de la case bloquant fait partie de l'empreinte du formulaire`, () => {
    const dialog = setup(mode);
    const unchecked = dialog.glue.getReferenceFormSnapshot(mode);

    dialog.setBloquant(true);
    const checked = dialog.glue.getReferenceFormSnapshot(mode);
    assert.notEqual(checked, unchecked);

    dialog.setBloquant(false);
    assert.equal(dialog.glue.getReferenceFormSnapshot(mode), unchecked);
  });

  test(`[${mode}] recopier une référence reprend son bloquant et réaffiche la durée`, () => {
    const dialog = setup(mode);

    dialog.glue.applyReferenceRowBloquantValue(mode, true);
    assert.equal(dialog.field('bloquant').checked, true);
    assert.equal(dialog.durationField.hidden, false);

    dialog.glue.applyReferenceRowBloquantValue(mode, false);
    assert.equal(dialog.field('bloquant').checked, false);
    assert.equal(dialog.durationField.hidden, true);
  });
}

test('une durée limite par défaut rend les données d’entrée créées bloquantes', () => {
  const { glue } = setup('add');
  assert.equal(glue.isReferenceDefaultDurationBloquant('2'), true);
  assert.equal(glue.isReferenceDefaultDurationBloquant('0'), true);
  assert.equal(glue.isReferenceDefaultDurationBloquant(0), true);
  assert.equal(glue.isReferenceDefaultDurationBloquant(''), false);
  assert.equal(glue.isReferenceDefaultDurationBloquant('   '), false);
  assert.equal(glue.isReferenceDefaultDurationBloquant(null), false);
  assert.equal(glue.isReferenceDefaultDurationBloquant('abc'), false);
  assert.equal(glue.isReferenceDefaultDurationBloquant('-1'), false);
});

// Les lignes d'avant la case, et celles que « Planning Projet » écrit sans cocher
// le bloquant, portent une durée avec Bloquant à faux. Les ouvrir case décochée
// masquerait cette durée et l'enregistrement suivant l'effacerait.
test('une durée déjà stockée suffit à ouvrir la ligne comme bloquante', () => {
  const { glue } = setup('edit');
  assert.equal(glue.isReferenceRecordBloquant({ Bloquant: true, DureeLimite: '' }), true);
  assert.equal(glue.isReferenceRecordBloquant({ Bloquant: false, DureeLimite: '3' }), true);
  assert.equal(glue.isReferenceRecordBloquant({ Bloquant: false, DureeLimite: '0' }), true);
  assert.equal(glue.isReferenceRecordBloquant({ Bloquant: false, DureeLimite: '' }), false);
  assert.equal(glue.isReferenceRecordBloquant({ Bloquant: false, DureeLimite: 'abc' }), false);
  assert.equal(glue.isReferenceRecordBloquant(null), false);
});
