
// --- Global helpers guard (ensures availability even if earlier patches moved code) ---
(function () {
  if (typeof window !== 'undefined') {
    if (typeof window.normalizeNumeroRaw === 'undefined') {
      window.normalizeNumeroRaw = function (v) {
        if (v == null) return null;
        const s = String(v).trim();
        return (s === '' || s === '-' || s === '_') ? null : s;
      };
    }
    if (typeof window.numeroSortable === 'undefined') {
      window.numeroSortable = function (v) {
        const s = window.normalizeNumeroRaw(v);
        if (s == null) return Infinity;
        const n = Number(s);
        return Number.isFinite(n) ? n : Infinity;
      };
    }
    if (typeof window.parseNumeroForStorage === 'undefined') {
      window.parseNumeroForStorage = function (v) {
        return window.normalizeNumeroRaw(v);
      };
    }
    if (typeof window.numeroOrZero === 'undefined') {
      window.numeroOrZero = function (v) {
        return (v == null ? 0 : v);
      };
    }
  } else {
    if (typeof normalizeNumeroRaw === 'undefined') {
      var normalizeNumeroRaw = function (v) {
        if (v == null) return null;
        const s = String(v).trim();
        return (s === '' || s === '-' || s === '_') ? null : s;
      };
    }
    if (typeof numeroSortable === 'undefined') {
      var numeroSortable = function (v) {
        const s = normalizeNumeroRaw(v);
        if (s == null) return Infinity;
        const n = Number(s);
        return Number.isFinite(n) ? n : Infinity;
      };
    }
    if (typeof parseNumeroForStorage === 'undefined') {
      var parseNumeroForStorage = function (v) {
        return normalizeNumeroRaw(v);
      };
    }
    if (typeof numeroOrZero === 'undefined') {
      var numeroOrZero = function (v) { return (v == null ? 0 : v); };
    }
  }
})();
// --- End helpers guard ---

const SHARED_PROJECT_STORAGE_KEY = 'grist.selected-project';
const SHARED_PROJECT_ID_STORAGE_KEY = 'grist.selected-project-id';
const REFERENCE_DATA_CHANGE_STORAGE_KEY = 'grist.references-data-change';
const REFERENCE_ACTION_CHUNK_SIZE = 250;
let _projectsData = []; // [{id, number, name}]
let referenceDataChangeSignalBatchDepth = 0;
let referenceDataChangeSignalPending = false;

function emitReferenceDataChangeSignal() {
  if (referenceDataChangeSignalBatchDepth > 0) {
    referenceDataChangeSignalPending = true;
    return;
  }

  try {
    localStorage.setItem(
      REFERENCE_DATA_CHANGE_STORAGE_KEY,
      JSON.stringify({ at: Date.now(), source: 'reference2', nonce: Math.random() })
    );
  } catch (_error) {
    // localStorage peut etre indisponible dans certains contextes embarques.
  }
}

async function runWithBatchedReferenceDataChangeSignal(callback) {
  referenceDataChangeSignalBatchDepth += 1;
  try {
    return await callback();
  } finally {
    referenceDataChangeSignalBatchDepth = Math.max(0, referenceDataChangeSignalBatchDepth - 1);
    if (referenceDataChangeSignalBatchDepth === 0 && referenceDataChangeSignalPending) {
      referenceDataChangeSignalPending = false;
      emitReferenceDataChangeSignal();
    }
  }
}

async function applyUserActionsInChunks(actions = []) {
  const normalizedActions = Array.isArray(actions) ? actions.filter(Boolean) : [];
  if (!normalizedActions.length) return;

  await runWithBatchedReferenceDataChangeSignal(async () => {
    for (let offset = 0; offset < normalizedActions.length; offset += REFERENCE_ACTION_CHUNK_SIZE) {
      await grist.docApi.applyUserActions(
        normalizedActions.slice(offset, offset + REFERENCE_ACTION_CHUNK_SIZE)
      );
    }
  });
}

function readSharedProjectSelection() {
  try {
    return String(localStorage.getItem(SHARED_PROJECT_STORAGE_KEY) || '').trim();
  } catch (_error) {
    return '';
  }
}

function readSharedProjectId() {
  try {
    const raw = localStorage.getItem(SHARED_PROJECT_ID_STORAGE_KEY);
    const id = Number(raw);
    return Number.isInteger(id) && id > 0 ? id : null;
  } catch (_e) { return null; }
}

function saveSharedProjectSelection(projectName) {
  try {
    const normalizedProject = String(projectName || '').trim();
    if (normalizedProject) {
      localStorage.setItem(SHARED_PROJECT_STORAGE_KEY, normalizedProject);
      const project = _projectsData.find(
        (p) => p.name.trim().toLowerCase() === normalizedProject.toLowerCase()
      );
      if (project) localStorage.setItem(SHARED_PROJECT_ID_STORAGE_KEY, String(project.id));
    } else {
      localStorage.removeItem(SHARED_PROJECT_STORAGE_KEY);
      localStorage.removeItem(SHARED_PROJECT_ID_STORAGE_KEY);
    }
  } catch (_error) {
    // localStorage peut etre indisponible dans certains contextes embarques.
  }
}

function normalizeSharedProjectKey(projectName) {
  return String(projectName || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase('fr');
}

function findSharedProjectMatch(values, projectName) {
  const requestedKey = normalizeSharedProjectKey(projectName);
  if (!requestedKey) return '';

  return (values || []).find((value) =>
    normalizeSharedProjectKey(value) === requestedKey
  ) || '';
}



// Storage-normalizer: keeps document numbers as text so padding such as 0981 is preserved.

// Coerce null/undefined to 0 for storage, keep 0 as 0
function numeroOrZero(v) {
  return (v == null ? 0 : v);
}
function parseNumeroForStorage(v) {
  return normalizeNumeroRaw(v);
}


/* === Column normalization shim (DescriptionObservations, typos) === */
(function () {
  function normalizeCols(cols) {
    if (!cols || typeof cols !== 'object') return cols;
    const map = new Map([
      ['descriptionobservationss', 'DescriptionObservations'],
      ['descriptionobservation', 'DescriptionObservations'],
      ['descriptionobservations', 'DescriptionObservations'],
      ['description', 'DescriptionObservations'],
    ]);
    const out = {};
    for (const [k, v] of Object.entries(cols)) {
      const ck = String(k).toLowerCase();
      out[map.get(ck) || k] = v;
    }
    return out;
  }
  function patchGrist() {
    try {
      if (window.grist && grist.docApi && typeof grist.docApi.applyUserActions === 'function') {
        const _apply = grist.docApi.applyUserActions.bind(grist.docApi);
        grist.docApi.applyUserActions = function (actions) {
          const fixed = (actions || []).map(a => {
            if (Array.isArray(a) && a.length >= 4) {
              a[3] = normalizeReferenceActionFieldsForRetard(a, normalizeCols(a[3]));
            }
            return a;
          });
          const referencesChanged = fixed.some(a =>
            Array.isArray(a) &&
            isReferencesActionTableName(a[1]) &&
            ['AddRecord', 'UpdateRecord', 'RemoveRecord'].includes(String(a[0] || ''))
          );
          const containsReferenceRetardActions = fixed.some(a =>
            Array.isArray(a) &&
            isReferencesActionTableName(a[1]) &&
            a[3] &&
            typeof a[3] === 'object' &&
            hasOwnField(a[3], 'Retard')
          );
          const applyFixedActions = async () => {
            if (!containsReferenceRetardActions || fixed.length <= REFERENCE_ACTION_CHUNK_SIZE) {
              return _apply(fixed);
            }

            let lastResult;
            for (let offset = 0; offset < fixed.length; offset += REFERENCE_ACTION_CHUNK_SIZE) {
              lastResult = await _apply(fixed.slice(offset, offset + REFERENCE_ACTION_CHUNK_SIZE));
            }
            return lastResult;
          };
          return Promise.resolve(applyFixedActions()).then(result => {
            if (referencesChanged) {
              emitReferenceDataChangeSignal();
            }
            return result;
          });
        };
      }
    } catch (e) { }
  }
  if (document.readyState === 'complete' || document.readyState === 'interactive') patchGrist();
  else window.addEventListener('DOMContentLoaded', patchGrist);
})();
/* === end shim === */

// Variable pour stocker l'émetteur capturé depuis le menu contextuel
let currentContextMenuEmitter = '';

// Fonction pour afficher le menu contextuel et capturer l'émetteur de la ligne
function showContextMenu(event, recordId) {
  event.preventDefault();

  const record = records.find(r => r.id === recordId); // Trouver la ligne cliquée
  if (record) {
    currentContextMenuEmitter = record.Emetteur; // Capturer l'émetteur de la ligne cliquée
  }

  const contextMenu = document.getElementById('contextMenu');
  contextMenu.style.display = 'block';
  contextMenu.style.left = `${event.pageX}px`;
  contextMenu.style.top = `${event.pageY}px`;
}

// Cacher le menu contextuel lorsqu'on clique ailleurs
document.addEventListener('click', function (event) {
  const contextMenu = document.getElementById('contextMenu');
  const editDialog = document.getElementById('editRowDialog');
  // Si le clic est en dehors du menu contextuel
  if (!contextMenu.contains(event.target)) {
    contextMenu.style.display = 'none';
    if (!editDialog.open) {
      document.querySelectorAll('#tableBody tr.highlighted, #tableBody td.highlighted').forEach(el => {
        el.classList.remove('highlighted');
      });
    }
  }
});

function updateReferenceList() {
  const selectedProject = document.getElementById('firstColumnDropdown').value;
  const selectedEmitter = document.getElementById('emetteur').value || currentContextMenuEmitter;
  const referenceList = document.getElementById('referenceList');

  // Vérifier si le projet et l'émetteur sont valides
  if (!selectedProject || !selectedEmitter) {
    referenceList.innerHTML = '';
    return;
  }

  // Vider la liste existante
  referenceList.innerHTML = '';

  // 1) Option par défaut "_"
  const defaultOption = document.createElement('option');
  defaultOption.value = '_';    // La valeur qu'on veut proposer
  referenceList.appendChild(defaultOption);

  // 2) Puis insérer les références filtrées
  const filteredReferences = records
    .filter(record => record.NomProjet === selectedProject && record.Emetteur === selectedEmitter)
    .map(record => record.Reference)
    .filter((value, index, self) => value && self.indexOf(value) === index)
    .sort((a, b) => a.localeCompare(b, 'fr', { ignorePunctuation: true }));

  filteredReferences.forEach(reference => {
    const option = document.createElement('option');
    option.value = reference;
    referenceList.appendChild(option);
  });
}

// Fonction pour remplir automatiquement les champs en fonction de la référence sélectionnée
function autoFillFields() {
  const selectedReference = document.getElementById('referenceInput').value;
  const selectedProject = document.getElementById('firstColumnDropdown').value;
  const selectedEmitter = document.getElementById('emetteur').value || currentContextMenuEmitter;

  if (!selectedReference || !selectedProject || !selectedEmitter) {
    return;
  }

  // Si c'est "_", on remplit avec les valeurs par défaut
  if (selectedReference === '_') {
    document.getElementById('indice').value = '-';
    document.getElementById('recu').value = '';
    document.getElementById('description').value = 'EN ATTENTE';
    document.getElementById('remarque').value = 'Officiel';
    document.getElementById('dureeLimite').value = '';
    void fillAddRowDefaultDurationFromContext({ force: true });
    return;
  }

  // Sinon, on cherche un enregistrement dans `records` pour autofill
  const matchingRecord = records.find(record =>
    record.NomProjet === selectedProject &&
    record.Emetteur === selectedEmitter &&
    record.Reference === selectedReference
  );

  if (matchingRecord) {
    // Remplir avec les infos réelles
    document.getElementById('indice').value = matchingRecord.Indice || '';
    document.getElementById('description').value = matchingRecord.DescriptionObservations || '';
    document.getElementById('remarque').value = normalizeRemarqueValue(matchingRecord.Remarque);
    document.getElementById('recu').value = formatReferenceDialogDate(matchingRecord.Recu);
    document.getElementById('dureeLimite').value = formatReferenceDurationInput(matchingRecord.DureeLimite);
    void resolveReferenceDurationInputValue(matchingRecord).then((durationValue) => {
      if (document.getElementById('referenceInput')?.value === selectedReference) {
        document.getElementById('dureeLimite').value = durationValue;
      }
    });
  } else {
    // Rien trouvé -> vider les champs (ou gérer autrement)
    document.getElementById('indice').value = '';
    document.getElementById('description').value = '';
    document.getElementById('remarque').value = '';
    document.getElementById('recu').value = '';
    document.getElementById('dureeLimite').value = '';
  }
}

const REFERENCE_ROW_FORM_CONFIG = {
  add: {
    dialogId: 'addRowDialog',
    statusId: 'addRowFormStatus',
    submitId: 'confirmAddRowButton',
    cancelId: 'cancelAddRowButton',
    fileId: 'referenceFile',
    fileStatusId: 'referenceFileStatus',
    fileClearId: 'clearReferenceFileButton',
    contextPrefix: 'add',
    fields: {
      emetteur: 'emetteur',
      reference: 'referenceInput',
      indice: 'indice',
      recu: 'recu',
      description: 'description',
      remarque: 'remarque',
      dureeLimite: 'dureeLimite',
    },
  },
  edit: {
    dialogId: 'editRowDialog',
    statusId: 'editRowFormStatus',
    submitId: 'confirmEditRowButton',
    cancelId: 'cancelEditRowButton',
    fileId: 'editReferenceFile',
    fileStatusId: 'editReferenceFileStatus',
    fileClearId: 'clearEditReferenceFileButton',
    contextPrefix: 'edit',
    fields: {
      emetteur: 'editEmetteur',
      reference: 'editReference',
      indice: 'editIndice',
      recu: 'editRecu',
      description: 'editDescription',
      remarque: 'editRemarque',
      dureeLimite: 'editDureeLimite',
    },
  },
};

const REFERENCES2_DIALOG_WRITABLE_FIELDS = new Set([
  'NomProjet',
  'NomDocument',
  'NumeroDocument',
  'Type_document',
  'Zone',
  'Emetteur',
  'Reference',
  'Indice',
  'Recu',
  'DescriptionObservations',
  'Remarque',
  'DureeLimite',
  'DateLimite',
  'Retard',
  'Service',
]);

let referenceEditInitialSnapshot = '';
let referenceToastTimer = 0;
const referenceFormBusyState = { add: false, edit: false };

function getReferenceRowFormConfig(mode) {
  return REFERENCE_ROW_FORM_CONFIG[mode] || REFERENCE_ROW_FORM_CONFIG.add;
}

function getReferenceRowForm(mode) {
  const dialog = document.getElementById(getReferenceRowFormConfig(mode).dialogId);
  return dialog?.querySelector('form') || null;
}

function getReferenceRowField(mode, fieldName) {
  const fieldId = getReferenceRowFormConfig(mode).fields[fieldName];
  return fieldId ? document.getElementById(fieldId) : null;
}

function sanitizeReferences2DialogFields(fields) {
  return Object.fromEntries(
    Object.entries(fields || {}).filter(([key, value]) =>
      REFERENCES2_DIALOG_WRITABLE_FIELDS.has(key) && value !== undefined
    )
  );
}

function formatReferenceDialogDate(value) {
  const date = parseReferenceRetardCalendarDate(value);
  return isEmptyReferenceRetardDate(date) ? '' : formatReferenceDateIso(date);
}

function setReferenceFormStatus(mode, message = '', type = '') {
  const status = document.getElementById(getReferenceRowFormConfig(mode).statusId);
  if (!status) return;
  status.textContent = message;
  status.classList.toggle('is-error', type === 'error');
  status.classList.toggle('is-info', type === 'info');
}

function showReferenceToast(message, { warning = false } = {}) {
  const toast = document.getElementById('referenceToast');
  if (!toast) return;
  window.clearTimeout(referenceToastTimer);
  toast.textContent = message;
  toast.classList.toggle('is-warning', warning);
  toast.hidden = false;
  referenceToastTimer = window.setTimeout(() => {
    toast.hidden = true;
  }, 4500);
}

function clearReferenceFieldError(input) {
  if (!(input instanceof HTMLElement)) return;
  input.classList.remove('is-invalid');
  input.removeAttribute('aria-invalid');
  const field = input.closest('.reference-field');
  field?.querySelector('.reference-field-error')?.remove();
}

function setReferenceFieldError(input, message) {
  if (!(input instanceof HTMLElement)) return;
  clearReferenceFieldError(input);
  input.classList.add('is-invalid');
  input.setAttribute('aria-invalid', 'true');
  const field = input.closest('.reference-field');
  if (!field) return;
  const error = document.createElement('p');
  error.className = 'reference-field-error';
  error.textContent = message;
  field.appendChild(error);
}

function clearReferenceFormErrors(mode) {
  const form = getReferenceRowForm(mode);
  form?.querySelectorAll('.is-invalid').forEach(clearReferenceFieldError);
  form?.querySelectorAll('.reference-field-error').forEach(error => error.remove());
}

function validateReferenceRowForm(mode, { focus = true } = {}) {
  clearReferenceFormErrors(mode);
  const requiredFields = [
    ['emetteur', "L'émetteur est obligatoire."],
    ['reference', 'La référence est obligatoire.'],
    ['indice', "L'indice est obligatoire."],
    ['description', 'La description est obligatoire.'],
    ['remarque', 'La remarque est obligatoire.'],
  ];
  let firstInvalid = null;

  requiredFields.forEach(([fieldName, message]) => {
    const input = getReferenceRowField(mode, fieldName);
    if (!String(input?.value || '').trim()) {
      setReferenceFieldError(input, message);
      firstInvalid ||= input;
    }
  });

  const durationInput = getReferenceRowField(mode, 'dureeLimite');
  const durationValue = String(durationInput?.value || '').trim();
  if (durationValue && parseReferenceDurationLimit(durationValue) == null) {
    setReferenceFieldError(durationInput, 'Saisissez un nombre entier positif ou nul.');
    firstInvalid ||= durationInput;
  }

  if (firstInvalid && focus) {
    firstInvalid.focus();
  }
  return !firstInvalid;
}

function getReferenceFormSnapshot(mode) {
  const config = getReferenceRowFormConfig(mode);
  return JSON.stringify(Object.fromEntries(
    Object.entries(config.fields).map(([name, id]) => [
      name,
      String(document.getElementById(id)?.value || '').trim(),
    ])
  ));
}

function updateEditSubmitState() {
  const submit = document.getElementById('confirmEditRowButton');
  if (!submit) return;
  const unchanged = Boolean(referenceEditInitialSnapshot) &&
    getReferenceFormSnapshot('edit') === referenceEditInitialSnapshot;
  submit.disabled = referenceFormBusyState.edit || unchanged;
  submit.title = unchanged ? 'Aucune modification à enregistrer' : '';
}

function setReferenceFormBusy(mode, busy, message = '') {
  const config = getReferenceRowFormConfig(mode);
  referenceFormBusyState[mode] = Boolean(busy);
  const dialog = document.getElementById(config.dialogId);
  const submit = document.getElementById(config.submitId);
  const cancel = document.getElementById(config.cancelId);
  dialog?.setAttribute('aria-busy', busy ? 'true' : 'false');
  if (submit) submit.disabled = Boolean(busy);
  if (cancel) cancel.disabled = Boolean(busy);
  if (message) setReferenceFormStatus(mode, message, 'info');
  if (!busy && mode === 'edit') updateEditSubmitState();
}

function resetReferenceFilePicker(mode) {
  const config = getReferenceRowFormConfig(mode);
  const fileInput = document.getElementById(config.fileId);
  const status = document.getElementById(config.fileStatusId);
  const clearButton = document.getElementById(config.fileClearId);
  if (fileInput) fileInput.value = '';
  if (status) {
    status.textContent = mode === 'edit'
      ? 'Aucun nouveau fichier sélectionné. Seul son nom sera utilisé.'
      : 'Aucun fichier sélectionné. Seul son nom sera utilisé.';
  }
  if (clearButton) clearButton.hidden = true;
}

function applyReferenceFileSelection(mode) {
  const config = getReferenceRowFormConfig(mode);
  const fileInput = document.getElementById(config.fileId);
  const referenceInput = getReferenceRowField(mode, 'reference');
  const status = document.getElementById(config.fileStatusId);
  const clearButton = document.getElementById(config.fileClearId);
  const file = fileInput?.files?.[0];
  if (!file || !referenceInput) {
    resetReferenceFilePicker(mode);
    return;
  }

  const referenceName = removeFileExtension(file.name);
  referenceInput.value = referenceName;
  clearReferenceFieldError(referenceInput);
  if (status) status.textContent = `Fichier : ${file.name} · Référence : ${referenceName}`;
  if (clearButton) clearButton.hidden = false;
  if (mode === 'edit') updateEditSubmitState();
  if (mode === 'add') updateDuplicateSelectionSummary();
}

function updateReferenceDialogContext(mode, record = null) {
  const config = getReferenceRowFormConfig(mode);
  const documentInfo = record
    ? {
        name: record.NomDocument,
        numero: record.NumeroDocument,
        zone: record.Zone,
        type: record.Type_document,
      }
    : getSelectedDocPair();
  const project = record?.NomProjet || selectedFirstValue ||
    document.getElementById('firstColumnDropdown')?.value || '';
  const values = {
    Project: project || '—',
    Document: documentInfo?.name ? makeDocLabel(documentInfo.name, documentInfo.numero) : '—',
    Zone: normalizeZoneValue(documentInfo?.zone) || '—',
    Type: normalizeTypeDocument(documentInfo?.type) || '—',
  };

  Object.entries(values).forEach(([suffix, value]) => {
    const target = document.getElementById(`${config.contextPrefix}Context${suffix}`);
    if (target) {
      target.textContent = value;
      target.title = value;
    }
  });
}

function getReferenceDuplicateIdentity(fields) {
  return [
    fields?.NomProjet,
    fields?.NomDocument,
    fields?.NumeroDocument,
    fields?.Type_document,
    normalizeZoneValue(fields?.Zone),
    fields?.Emetteur,
    fields?.Reference,
    fields?.Indice,
    fields?.Service,
  ].map(normalizeReferenceDocumentIdentityPart).join('||');
}

function findReferenceDialogDuplicate(fields, { ignoreRecordId = null } = {}) {
  const identity = getReferenceDuplicateIdentity(fields);
  if (!identity) return null;
  return (records || []).find(record =>
    Number(record?.id) !== Number(ignoreRecordId) &&
    !record?.Archive &&
    getReferenceDuplicateIdentity(record) === identity
  ) || null;
}

// Réinitialise l'ajout depuis une seule source de vérité.
async function resetAndUpdateDialog() {
  const form = getReferenceRowForm('add');
  form?.reset();
  clearReferenceFormErrors('add');
  setReferenceFormStatus('add');
  resetReferenceFilePicker('add');
  resetDuplicateSelectedDocumentValues();

  const duplicateOptionsContainer = document.getElementById('duplicateOptionsContainer');
  if (duplicateOptionsContainer) {
    duplicateOptionsContainer.hidden = true;
    duplicateOptionsContainer.innerHTML = '';
  }

  const emitter = document.getElementById('emetteur');
  if (emitter) emitter.value = currentEmetteur || '';
  updateReferenceDialogContext('add');
  updateReferenceList();
  updateDuplicateSelectionSummary();

  await Promise.all([
    updateEmetteurList(false, 'emetteurList'),
    fillAddRowDefaultDurationFromContext(),
  ]);
}

// Mise à jour de la liste des références lorsqu'on change le projet ou l'émetteur
document.getElementById('firstColumnDropdown').addEventListener('change', updateReferenceList);
document.getElementById('emetteur').addEventListener('change', updateReferenceList);

// L'auto-remplissage se déclenche après validation d'une valeur, pas à chaque frappe.
document.getElementById('referenceInput').addEventListener('change', autoFillFields);

document.getElementById('selectReferenceFileButton').addEventListener('click', () => {
  document.getElementById('referenceFile').click();
});
document.getElementById('referenceFile').addEventListener('change', () => {
  applyReferenceFileSelection('add');
});
document.getElementById('clearReferenceFileButton').addEventListener('click', () => {
  resetReferenceFilePicker('add');
  document.getElementById('referenceInput')?.focus();
});

getReferenceRowForm('add')?.addEventListener('input', (event) => {
  if (event.target.closest?.('.reference-field')) {
    clearReferenceFieldError(event.target);
    setReferenceFormStatus('add');
    updateDuplicateSelectionSummary();
  }
});


// === Separator between original <script> blocks ===


// window.alert = function () {
//   debugger;
// }
let records = [];
let referenceRecordsReady = false;
let selectedFirstValue = '';
let selectedSecondValue = '';
let selectedTypeValue = '';
let selectedDocNumber = null; let selectedDocName = ''; let selectedDocZone = '';
const REFERENCE_ALL_ZONES_VALUE = '__ALL_ZONES__';
const REFERENCE_NO_ZONE_VALUE = '__NO_ZONE__';
let selectedZoneValue = REFERENCE_ALL_ZONES_VALUE;

// --- ListePlan NDC+COF integration (création automatique lors de l'ajout de document(s)) ---
const LISTEPLAN_TABLE_CANDIDATES = ['ListePlan_NDC_COF', 'ListePlan NDC+COF', 'ListePlan_NDC+COF'];
let __listePlanTableName = null;
const PLANNING_TABLE_CANDIDATES = ['Planning_Projet', 'Planning_Project'];
let __planningTableName = null;

async function resolveListePlanTableName() {
  if (__listePlanTableName) return __listePlanTableName;
  for (const name of LISTEPLAN_TABLE_CANDIDATES) {
    try {
      await grist.docApi.fetchTable(name);
      __listePlanTableName = name;
      return name;
    } catch (e) {
      // ignore, try next
    }
  }
  throw new Error("Table ListePlan introuvable (attendu: 'ListePlan_NDC_COF' ou 'ListePlan NDC+COF').");
}

function normalizeRemarqueValue(value) {
  const text = String(value ?? '').trim();
  return text === 'Conservatoire' || text === 'Officiel' ? text : '';
}

async function resolvePlanningTableName() {
  if (__planningTableName) return __planningTableName;
  for (const name of PLANNING_TABLE_CANDIDATES) {
    try {
      await grist.docApi.fetchTable(name);
      __planningTableName = name;
      return name;
    } catch (e) {
      // ignore, try next
    }
  }
  throw new Error("Table Planning introuvable (attendu: 'Planning_Projet' ou 'Planning_Project').");
}

function isoToday() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function _norm(v) {
  return String(v ?? '').trim();
}

function normalizeServiceMatchKey(value) {
  return _norm(value).toLocaleLowerCase('fr');
}

function normalizeReferenceDocumentIdentityPart(value) {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('fr');
}

function normalizeReferenceDocumentIdentityInput(documentValue) {
  if (!documentValue || typeof documentValue !== 'object') {
    throw new Error("Le controle d'identite exige le numero, le nom et le type du document.");
  }
  const documentIdentity = {
    number: _norm(documentValue.number ?? documentValue.numero ?? documentValue.documentNumber),
    name: _norm(documentValue.name ?? documentValue.nom ?? documentValue.documentName),
    type: normalizeTypeDocument(
      documentValue.type ?? documentValue.documentType ?? documentValue.typeDocument
    ),
  };
  if (!documentIdentity.number || !documentIdentity.name || !documentIdentity.type) {
    throw new Error("Le numero, le nom et le type du document sont obligatoires.");
  }
  return documentIdentity;
}

function buildReferenceDocumentUniquenessKey(documentValue) {
  const number = normalizeReferenceDocumentIdentityPart(
    documentValue?.number ?? documentValue?.numero ?? documentValue?.documentNumber
  );
  const type = normalizeReferenceDocumentIdentityPart(
    documentValue?.type ?? documentValue?.documentType ?? documentValue?.typeDocument
  );
  if (!number || !type) {
    throw new Error("Le numero et le type du document sont obligatoires.");
  }
  return [
    number,
    type,
  ].join('||');
}

function normalizeDocumentProjectKey(value) {
  const raw = Array.isArray(value)
    ? value[value.length - 1]
    : value && typeof value === 'object'
      ? (value.details ?? value.display ?? value.label ?? value.name ?? value.id ?? value)
      : value;
  return String(raw ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('fr');
}

async function buildDocumentProjectAliasKeys(projectName) {
  const aliases = new Set([normalizeDocumentProjectKey(projectName)].filter(Boolean));
  const projects = await grist.docApi.fetchTable('Projets2');
  const ids = projects.id || [];
  const names = projects.Nom_de_projet || [];
  const requestedKey = normalizeDocumentProjectKey(projectName);

  for (let index = 0; index < Math.max(ids.length, names.length); index += 1) {
    const rowKeys = [ids[index], names[index]]
      .map(normalizeDocumentProjectKey)
      .filter(Boolean);
    if (!rowKeys.includes(requestedKey)) continue;
    rowKeys.forEach((key) => aliases.add(key));
  }
  return aliases;
}

async function assertReferenceDocumentIdentitiesAvailable(projectName, documents, service) {
  const serviceKey = normalizeServiceMatchKey(service);
  if (!serviceKey) {
    throw new Error('Le service est obligatoire pour controler les documents existants.');
  }
  const normalizedDocuments = (documents || []).map(normalizeReferenceDocumentIdentityInput);
  const requestedUniquenessKeys = new Set();
  for (const documentIdentity of normalizedDocuments) {
    const uniquenessKey = buildReferenceDocumentUniquenessKey(documentIdentity);
    if (requestedUniquenessKeys.has(uniquenessKey)) {
      throw new Error(
        `Le numero de document "${documentIdentity.number}" est saisi plusieurs fois pour le type "${documentIdentity.type}".`
      );
    }
    requestedUniquenessKeys.add(uniquenessKey);
  }

  const [tableName, projectAliases] = await Promise.all([
    resolveListePlanTableName(),
    buildDocumentProjectAliasKeys(projectName),
  ]);
  const plans = await grist.docApi.fetchTable(tableName);
  const projects = plans.Nom_projet || plans.NomProjet || plans.NomProjetString || [];
  const numbers = plans.NumeroDocument || plans.ID2 || [];
  const types = plans.Type_document || plans.Type_doc || plans.TypeDocument || plans.TypeDoc || [];
  const services = plans.Service || [];

  for (let index = 0; index < Math.max(projects.length, numbers.length, types.length, services.length); index += 1) {
    if (normalizeServiceMatchKey(services[index]) !== serviceKey) continue;
    if (!projectAliases.has(normalizeDocumentProjectKey(projects[index]))) continue;
    if (
      !normalizeReferenceDocumentIdentityPart(numbers[index]) ||
      !normalizeReferenceDocumentIdentityPart(types[index])
    ) continue;
    const rowIdentity = {
      number: numbers[index],
      type: types[index],
    };
    if (requestedUniquenessKeys.has(buildReferenceDocumentUniquenessKey(rowIdentity))) {
      throw new Error(
        `Le numero de document "${rowIdentity.number}" existe deja pour le type "${rowIdentity.type}" dans ce projet.`
      );
    }
  }
}

function findListePlanIndex(plansTable, projectName, numeroDocStr, typeDocStr = '', zoneStr = '', taskName = '', service = '') {
  const projs = plansTable.Nom_projet || [];
  const nums  = plansTable.NumeroDocument || [];
  const types = plansTable.Type_document || [];
  const zones = plansTable.Zone || [];
  const names = plansTable.Designation || plansTable.NomDocument || [];
  const services = plansTable.Service || [];
  const p = _norm(projectName);
  const n = _norm(numeroDocStr);
  const t = _norm(typeDocStr);
  const z = normalizeZoneMatchKey(zoneStr);
  const task = _norm(taskName);
  const serviceKey = normalizeServiceMatchKey(service);
  for (let i = 0; i < Math.max(projs.length, nums.length, types.length, zones.length, names.length, services.length); i++) {
    if (
      _norm(projs[i]) === p &&
      _norm(nums[i]) === n &&
      _norm(types[i]) === t &&
      normalizeServiceMatchKey(services[i]) === serviceKey &&
      (!task || _norm(names[i]) === task) &&
      normalizeZoneMatchKey(zones[i]) === z
    ) {
      return i;
    }
  }
  return -1;
}

function hasPlanningColumn(planningTable, columnName) {
  return Boolean(planningTable) && Object.prototype.hasOwnProperty.call(planningTable, columnName);
}

function setPlanningFieldIfPresent(planningTable, fields, columnName, value) {
  if (hasPlanningColumn(planningTable, columnName)) {
    fields[columnName] = value;
  }
}

function getPlanningProjectColumn(planningTable) {
  if (hasPlanningColumn(planningTable, 'NomProjet')) return 'NomProjet';
  if (hasPlanningColumn(planningTable, 'Nom_projet')) return 'Nom_projet';
  return 'NomProjet';
}

function getPlanningTaskColumn(planningTable) {
  if (hasPlanningColumn(planningTable, 'Taches')) return 'Taches';
  if (hasPlanningColumn(planningTable, 'Tache')) return 'Tache';
  if (hasPlanningColumn(planningTable, 'Designation')) return 'Designation';
  return 'Taches';
}

function planningZoneExists(planningTable, projectName, zoneStr = '', service = '') {
  const normalizedZone = normalizeZoneValue(zoneStr);
  const normalizedZoneKey = normalizeZoneMatchKey(normalizedZone);
  if (!normalizedZone) return true;

  const projectCol = getPlanningProjectColumn(planningTable);
  const projs = planningTable?.[projectCol] || [];
  const zones = planningTable?.Zone || [];
  const services = planningTable?.Service || [];
  const p = _norm(projectName);
  const serviceKey = normalizeServiceMatchKey(service);

  for (let i = 0; i < Math.max(projs.length, zones.length, services.length); i++) {
    if (
      _norm(projs[i]) === p &&
      normalizeZoneMatchKey(zones[i]) === normalizedZoneKey &&
      normalizeServiceMatchKey(services[i]) === serviceKey
    ) {
      return true;
    }
  }
  return false;
}

function buildPlanningZoneAnchorFields(planningTable, projectName, zoneStr = '', service = '') {
  const projectCol = getPlanningProjectColumn(planningTable);
  const taskCol = getPlanningTaskColumn(planningTable);
  const normalizedZone = normalizeZoneValue(zoneStr);
  const fields = {};
  const serviceValue = _norm(service);
  if (!serviceValue) throw new Error('Le service est obligatoire pour creer une zone Planning.');
  if (!hasPlanningColumn(planningTable, 'Service')) {
    throw new Error('La colonne Service est absente de Planning_Projet.');
  }

  setPlanningFieldIfPresent(planningTable, fields, 'ID2', '');
  setPlanningFieldIfPresent(planningTable, fields, taskCol, '');
  setPlanningFieldIfPresent(planningTable, fields, 'Type_doc', '');
  setPlanningFieldIfPresent(planningTable, fields, 'Prev_Indice_0', null);
  setPlanningFieldIfPresent(planningTable, fields, 'Date_limite', null);
  setPlanningFieldIfPresent(planningTable, fields, 'Duree_1', 0);
  setPlanningFieldIfPresent(planningTable, fields, 'Diff_coffrage', null);
  setPlanningFieldIfPresent(planningTable, fields, 'Duree_2', 0);
  setPlanningFieldIfPresent(planningTable, fields, 'Diff_armature', null);
  setPlanningFieldIfPresent(planningTable, fields, 'Duree_3', 0);
  setPlanningFieldIfPresent(planningTable, fields, 'Demarrages_travaux', null);
  setPlanningFieldIfPresent(planningTable, fields, 'Retards', 0);
  setPlanningFieldIfPresent(planningTable, fields, 'Indice', '');
  setPlanningFieldIfPresent(planningTable, fields, 'Realise', 0);
  setPlanningFieldIfPresent(planningTable, fields, projectCol, _norm(projectName));
  setPlanningFieldIfPresent(planningTable, fields, 'Groupe', '');
  setPlanningFieldIfPresent(planningTable, fields, 'Zone', normalizedZone);
  setPlanningFieldIfPresent(planningTable, fields, 'Service', serviceValue);

  return fields;
}

function buildPlanningZoneAnchorActionIfMissing(planningTableName, planningTable, projectName, zoneStr = '', service = '') {
  const normalizedZone = normalizeZoneValue(zoneStr);
  if (!normalizedZone) return null;
  if (planningZoneExists(planningTable, projectName, normalizedZone, service)) return null;

  return ['AddRecord', planningTableName, null, buildPlanningZoneAnchorFields(planningTable, projectName, normalizedZone, service)];
}

function buildPlanningDocumentUpdateFields(planningTable, {
  taskName = '',
  typeDoc = '',
  zoneStr = ''
} = {}) {
  const taskCol = getPlanningTaskColumn(planningTable);
  const fields = {};

  setPlanningFieldIfPresent(planningTable, fields, taskCol, String(taskName ?? '').trim());
  setPlanningFieldIfPresent(planningTable, fields, 'Type_doc', String(typeDoc ?? '').trim());
  setPlanningFieldIfPresent(planningTable, fields, 'Zone', normalizeZoneValue(zoneStr));

  return fields;
}

function buildPlanningDocumentAddFields(planningTable, {
  projectName = '',
  numeroDocStr = '',
  taskName = '',
  typeDoc = '',
  zoneStr = '',
  service = ''
} = {}) {
  const projectCol = getPlanningProjectColumn(planningTable);
  const taskCol = getPlanningTaskColumn(planningTable);
  const fields = {};
  const serviceValue = _norm(service);
  if (!serviceValue) throw new Error('Le service est obligatoire pour creer un document Planning.');
  if (!hasPlanningColumn(planningTable, 'Service')) {
    throw new Error('La colonne Service est absente de Planning_Projet.');
  }

  setPlanningFieldIfPresent(planningTable, fields, projectCol, _norm(projectName));
  setPlanningFieldIfPresent(planningTable, fields, 'ID2', _norm(numeroDocStr));
  setPlanningFieldIfPresent(planningTable, fields, taskCol, String(taskName ?? '').trim());
  setPlanningFieldIfPresent(planningTable, fields, 'Type_doc', String(typeDoc ?? '').trim());
  setPlanningFieldIfPresent(planningTable, fields, 'Indice', '');
  setPlanningFieldIfPresent(
    planningTable,
    fields,
    'Groupe',
    getDefaultPlanningGroupForType(typeDoc, planningTable, projectName, serviceValue)
  );
  setPlanningFieldIfPresent(planningTable, fields, 'Zone', normalizeZoneValue(zoneStr));
  setPlanningFieldIfPresent(planningTable, fields, 'Service', serviceValue);

  return fields;
}

function findPlanningIndex(planningTable, projectName, numeroDocStr, typeDocStr, zoneStr = '', taskName = '', service = '') {
  const projectCol = getPlanningProjectColumn(planningTable);
  const taskCol = getPlanningTaskColumn(planningTable);
  const projs = planningTable?.[projectCol] || [];
  const ids2 = planningTable?.ID2 || [];
  const types = planningTable?.Type_doc || [];
  const zones = planningTable?.Zone || [];
  const tasks = planningTable?.[taskCol] || [];
  const services = planningTable?.Service || [];
  const p = _norm(projectName);
  const n = _norm(numeroDocStr);
  const t = _norm(typeDocStr);
  const z = normalizeZoneMatchKey(zoneStr);
  const serviceKey = normalizeServiceMatchKey(service);
  let legacyFallbackIndex = -1;
  const hasZoneColumn = hasPlanningColumn(planningTable, 'Zone');

  for (let i = 0; i < Math.max(projs.length, ids2.length, types.length, zones.length, tasks.length, services.length); i++) {
    if (_norm(projs[i]) !== p) continue;
    if (_norm(ids2[i]) !== n) continue;
    if (_norm(types[i]) !== t) continue;
    if (normalizeServiceMatchKey(services[i]) !== serviceKey) continue;
    if (_norm(taskName) && _norm(tasks[i]) !== _norm(taskName)) continue;

    const currentZone = hasZoneColumn ? normalizeZoneMatchKey(zones[i]) : '';
    if (currentZone === z) return i;

    const matchesLegacyBlankZone = z && currentZone === '';
    if (matchesLegacyBlankZone) {
      if (_norm(taskName) && _norm(tasks[i]) === _norm(taskName)) {
        return i;
      }
      if (legacyFallbackIndex < 0) {
        legacyFallbackIndex = i;
      }
    }
  }

  return legacyFallbackIndex;
}




// --- Cache local des numeros, avec chargement complet uniquement en fallback paresseux ---
let __refsDocNumCache = new Map(); // key: "<NomProjet>||<NomDocument>" -> NumeroDocument (max seen)
let __refsDocNumCacheInFlight = null;
let __refsDocNumCacheTimer = null;

function __docKey(proj, doc) {
  return `${String(proj || '').trim()}||${String(doc || '').trim()}`;
}

function getCachedNumeroDocument(proj, doc) {
  const key = __docKey(proj, doc);
  return __refsDocNumCache.has(key) ? __refsDocNumCache.get(key) : null;
}

function buildReferencesNumeroCache(sourceRecords = [], { merge = false } = {}) {
  const map = merge ? new Map(__refsDocNumCache) : new Map();
  (Array.isArray(sourceRecords) ? sourceRecords : []).forEach((record) => {
    const project = String(record?.NomProjet ?? '').trim();
    const documentName = String(record?.NomDocument ?? '').trim();
    if (!project || !documentName) return;

    const numero = parseNumeroForStorage(record?.NumeroDocument);
    if (numero == null) return;

    const key = __docKey(project, documentName);
    const previous = map.get(key);
    if (previous == null || (previous === '0' && numero !== '0')) {
      map.set(key, numero);
    }
  });
  __refsDocNumCache = map;
  return map;
}

async function refreshReferencesNumeroCache() {
  if (__refsDocNumCacheInFlight) return __refsDocNumCacheInFlight;
  __refsDocNumCacheInFlight = (async () => {
    try {
      const table = await grist.docApi.fetchTable('References2');
      const projects = table.NomProjet || [];
      const documents = table.NomDocument || [];
      const numbers = table.NumeroDocument || [];
      const rows = [];
      const length = Math.max(projects.length, documents.length, numbers.length);

      for (let index = 0; index < length; index++) {
        rows.push({
          NomProjet: projects[index],
          NomDocument: documents[index],
          NumeroDocument: numbers[index],
        });
      }
      buildReferencesNumeroCache(rows, { merge: true });
    } catch (error) {
      console.warn('refreshReferencesNumeroCache failed:', error);
    } finally {
      __refsDocNumCacheInFlight = null;
    }
  })();
  return __refsDocNumCacheInFlight;
}

function scheduleReferencesNumeroCacheRefresh() {
  try {
    clearTimeout(__refsDocNumCacheTimer);
    __refsDocNumCacheTimer = setTimeout(() => {
      refreshReferencesNumeroCache().then(() => {
        try { refreshSecondDropdownLabels(); } catch (e) { }
      });
    }, 50);
  } catch (e) { }
}
// --- End References NumeroDocument cache ---



// --- helper: reads the selected pair from the 2nd dropdown at commit time ---
function normalizeZoneValue(value) {
  return String(value ?? '').trim();
}

function normalizeZoneMatchKey(value) {
  return normalizeZoneValue(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('fr')
    .replace(/[^a-z0-9]/g, '');
}

function resolveCanonicalZoneValue(value, sourceZones = []) {
  const normalizedZone = normalizeZoneValue(value);
  const zoneKey = normalizeZoneMatchKey(normalizedZone);
  if (!zoneKey) return '';

  const matchingZone = (sourceZones || [])
    .map((zone) => normalizeZoneValue(zone))
    .find((zone) => normalizeZoneMatchKey(zone) === zoneKey);

  return matchingZone || normalizedZone;
}

function formatZoneLabel(value) {
  const normalized = normalizeZoneValue(value);
  return normalized || 'Sans zone';
}

function getCurrentSelectedZone() {
  const dropdown = document.getElementById('zoneDropdown');
  return _norm(dropdown?.value || selectedZoneValue || REFERENCE_ALL_ZONES_VALUE);
}

function getZoneDropdownOptionValue(zoneValue) {
  const normalizedZone = normalizeZoneValue(zoneValue);
  return normalizedZone || REFERENCE_NO_ZONE_VALUE;
}

function getZoneDropdownOptionLabel(zoneValue) {
  return normalizeZoneValue(zoneValue) || 'Sans zone';
}

function isAllReferenceZonesSelection(zoneValue) {
  const normalizedValue = _norm(zoneValue || REFERENCE_ALL_ZONES_VALUE);
  return !normalizedValue || normalizedValue === REFERENCE_ALL_ZONES_VALUE;
}

function matchesReferenceZoneSelection(zoneValue, selectionValue = getCurrentSelectedZone()) {
  if (isAllReferenceZonesSelection(selectionValue)) return true;
  if (_norm(selectionValue) === REFERENCE_NO_ZONE_VALUE) {
    return !normalizeZoneValue(zoneValue);
  }
  return normalizeZoneMatchKey(zoneValue) === normalizeZoneMatchKey(selectionValue);
}

function buildDocSelectValue({ numero = null, name = '', zone = '', type = '' } = {}) {
  return JSON.stringify({
    numero: parseNumeroForStorage(numero),
    name: String(name ?? '').trim(),
    zone: normalizeZoneValue(zone),
    type: normalizeTypeDocument(type),
  });
}

function getSelectedDocPair() {
  const el = document.getElementById('secondColumnListbox');
  if (!el) return { numero: null, name: '', zone: '', type: '' };

  const raw = el.value;
  const parsed = parseDocValue(raw);

  let numero = parsed.numero;
  let name = parsed.name || String(raw || '').trim();
  let zone = normalizeZoneValue(parsed.zone);
  const type = normalizeTypeDocument(parsed.type || getCurrentSelectedType());

  // Fallback 1: cache local si la colonne NumeroDocument n'est pas presente dans la vue
  if (numero == null) {
    try {
      const proj =
        (typeof selectedFirstValue !== 'undefined' && selectedFirstValue) ?
          String(selectedFirstValue).trim() :
          String(document.getElementById('firstColumnDropdown')?.value || '').trim();
      const cached = getCachedNumeroDocument(proj, name);
      if (cached != null) numero = cached;
    } catch (e) { }
  }

  // Fallback 2: parse le libellé affiché (ex: "5 5" ou "104 A5")
  if (numero == null) {
    try {
      const opt = el.options[el.selectedIndex];
      const txt = (opt && opt.textContent) ? opt.textContent.trim() : '';
      if (txt) {
        const m = txt.match(/^(\d+)\s+/) || txt.match(/^(\d+)$/);
        if (m) numero = parseNumeroForStorage(m[1]);
      }
    } catch (e) { }
  }

  return { numero, name, zone, type };
}


function parseDocValue(raw) {
  if (!raw) return { numero: null, name: '', zone: '', type: '' };

  // 1) Cas JSON (certaines parties du code pouvaient stocker un JSON dans la value)
  try {
    const obj = JSON.parse(raw);
    if (obj && (obj.n != null || obj.numero != null || obj.name != null || obj.nom != null || obj.zone != null || obj.type != null)) {
      const numero = (obj.n != null) ? obj.n : (obj.numero != null ? obj.numero : null);
      const name = (obj.name != null) ? obj.name : (obj.nom != null ? obj.nom : '');
      const zone = normalizeZoneValue(obj.zone);
      const type = normalizeTypeDocument(obj.type);
      return {
        numero: parseNumeroForStorage(numero),
        name: String(name).trim(),
        zone,
        type,
      };
    }
  } catch (e) { /* pas du JSON -> on continue */ }

  // 2) Cas normal : raw = NomDocument
  const name = String(raw).trim();
  let numero = null;
  let zone = '';
  let type = getCurrentSelectedType();

  // Projet courant
  const selectedProject =
    (typeof selectedFirstValue !== 'undefined' && selectedFirstValue) ?
      String(selectedFirstValue).trim() :
      String(document.getElementById('firstColumnDropdown')?.value || '').trim();

  // 2a) Essayer via records (vue courante)
  try {
    if (selectedProject && Array.isArray(records)) {
      const rec = records.find(r =>
        normalizeReferenceDocumentIdentityPart(r.NomProjet) ===
          normalizeReferenceDocumentIdentityPart(selectedProject) &&
        normalizeReferenceDocumentIdentityPart(r.NomDocument) ===
          normalizeReferenceDocumentIdentityPart(name) &&
        (!type ||
          normalizeReferenceDocumentIdentityPart(r.Type_document) ===
            normalizeReferenceDocumentIdentityPart(type))
      );

      // ⚠️ Important : si la colonne NumeroDocument n'est pas dans la vue, rec.NumeroDocument sera undefined
      if (rec && (rec.NumeroDocument !== undefined) && rec.NumeroDocument != null) {
        numero = parseNumeroForStorage(rec.NumeroDocument);
      }
      if (rec) {
        zone = normalizeZoneValue(rec.Zone);
        type = normalizeTypeDocument(rec.Type_document);
      }
    }
  } catch (e) { }

  // 2b) Fallback via le cache local
  if (numero == null && selectedProject) {
    try {
      const cached = getCachedNumeroDocument(selectedProject, name);
      if (cached != null) numero = cached;
    } catch (e) { }
  }

  // 2c) Si cache vide, on planifie un refresh (utile au 1er chargement)
  if (numero == null) {
    try { scheduleReferencesNumeroCacheRefresh(); } catch (e) { }
  }

  return { numero, name, zone, type };
}


function makeDocLabel(name, numero) {
  const nm = (name ?? '').toString().trim();
  // numéro affiché si présent; 0 est une valeur VALIDE
  let show;
  if (numero === 0 || numero === '0') {
    show = '0';
  } else if (numero == null) {
    show = null;
  } else {
    const s = String(numero).trim();
    show = (s === '' || s === '-' || s === '_') ? null : s;
  }
  return (show !== null) ? `${show} ${nm}` : nm;  // numero PUIS nom
}
function docLabelFromRecord(record) {
  const nm = record && record.NomDocument ? record.NomDocument : '';
  const num = (record && record.NumeroDocument != null) ? record.NumeroDocument : null;
  return makeDocLabel(nm, num);
}

function normalizeTypeDocument(value) {
  return String(value ?? '').trim().toLocaleUpperCase('fr');
}

function isCoffrageDocumentType(typeDoc) {
  const normalizedType = normalizeTypeDocument(typeDoc);
  return normalizedType.includes('COFFRAGE') || normalizedType.includes('COF');
}

function collectProjectPlanningGroups(planningTable, projectName, service) {
  const projectCol = getPlanningProjectColumn(planningTable);
  const projects = planningTable?.[projectCol] || [];
  const groups = planningTable?.Groupe || [];
  const services = planningTable?.Service || [];
  const projectKey = _norm(projectName);
  const serviceKey = normalizeServiceMatchKey(service);
  const usedGroups = new Set();

  for (let i = 0; i < Math.max(projects.length, groups.length, services.length); i++) {
    if (_norm(projects[i]) !== projectKey) continue;
    if (normalizeServiceMatchKey(services[i]) !== serviceKey) continue;

    const group = _norm(groups[i]);
    if (group) usedGroups.add(group.toLocaleLowerCase('fr'));
  }

  return usedGroups;
}

function getPlanningPendingGroupSet(planningTable, projectName, service) {
  if (!planningTable.__pendingOutOfProjectGroups) {
    Object.defineProperty(planningTable, '__pendingOutOfProjectGroups', {
      value: new Map(),
      enumerable: false
    });
  }

  const projectKey = `${_norm(projectName).toLocaleLowerCase('fr')}||${normalizeServiceMatchKey(service)}`;
  if (!planningTable.__pendingOutOfProjectGroups.has(projectKey)) {
    planningTable.__pendingOutOfProjectGroups.set(projectKey, collectProjectPlanningGroups(planningTable, projectName, service));
  }

  return planningTable.__pendingOutOfProjectGroups.get(projectKey);
}

function getNextAvailablePlanningGroupNumber(planningTable, projectName, service) {
  const usedGroups = getPlanningPendingGroupSet(planningTable, projectName, service);
  let nextGroupNumber = 1;

  while (usedGroups.has(String(nextGroupNumber).toLocaleLowerCase('fr'))) {
    nextGroupNumber += 1;
  }

  const candidate = String(nextGroupNumber);
  usedGroups.add(candidate.toLocaleLowerCase('fr'));
  return candidate;
}

function getDefaultPlanningGroupForType(typeDoc, planningTable = null, projectName = '', service = '') {
  return isCoffrageDocumentType(typeDoc)
    ? getNextAvailablePlanningGroupNumber(planningTable, projectName, service)
    : '';
}

function collectProjectZones(projectName) {
  const project = _norm(projectName);
  if (!project || !Array.isArray(records)) return [];

  const uniqueZones = new Set();
  const zones = [];

  records.forEach((record) => {
    if (_norm(record.NomProjet) !== project) return;
    const zone = normalizeZoneValue(record.Zone);
    const zoneKey = normalizeZoneMatchKey(zone);
    if (!zoneKey || uniqueZones.has(zoneKey)) return;
    uniqueZones.add(zoneKey);
    zones.push(zone);
  });

  return zones.sort((a, b) => a.localeCompare(b, 'fr', { sensitivity: 'base', numeric: true }));
}

function collectProjectZoneFilterValues(projectName, typeValue = '') {
  const project = normalizeReferenceDocumentIdentityPart(projectName);
  const normalizedType = normalizeTypeDocument(typeValue);
  if (!project || !Array.isArray(records)) return [];

  const zonesByKey = new Map();
  records.forEach((record) => {
    if (normalizeReferenceDocumentIdentityPart(record.NomProjet) !== project) return;
    if (
      normalizedType &&
      normalizeReferenceDocumentIdentityPart(record.Type_document) !==
        normalizeReferenceDocumentIdentityPart(normalizedType)
    ) return;

    const zone = normalizeZoneValue(record.Zone);
    const zoneKey = zone ? normalizeZoneMatchKey(zone) : REFERENCE_NO_ZONE_VALUE;
    if (!zonesByKey.has(zoneKey)) {
      zonesByKey.set(zoneKey, zone);
    }
  });

  return Array.from(zonesByKey.values()).sort(compareZoneKeys);
}

function resetZoneDropdown(disabled = true) {
  const dropdown = document.getElementById('zoneDropdown');
  if (!dropdown) return;

  dropdown.innerHTML = `<option value="${REFERENCE_ALL_ZONES_VALUE}">Toutes les zones</option>`;
  dropdown.value = REFERENCE_ALL_ZONES_VALUE;
  dropdown.disabled = disabled;
  selectedZoneValue = REFERENCE_ALL_ZONES_VALUE;
}

function populateZoneDropdown(selectedProject, preferredValue = null) {
  const dropdown = document.getElementById('zoneDropdown');
  if (!dropdown) return;

  const project = _norm(selectedProject);
  const desiredValue = _norm(
    preferredValue != null ? preferredValue : (selectedZoneValue || dropdown.value || REFERENCE_ALL_ZONES_VALUE)
  );

  dropdown.innerHTML = `<option value="${REFERENCE_ALL_ZONES_VALUE}">Toutes les zones</option>`;

  if (!project) {
    dropdown.value = REFERENCE_ALL_ZONES_VALUE;
    dropdown.disabled = true;
    selectedZoneValue = REFERENCE_ALL_ZONES_VALUE;
    return;
  }

  const zoneValues = collectProjectZoneFilterValues(project, getCurrentSelectedType());
  zoneValues.forEach((zoneValue) => {
    const option = document.createElement('option');
    option.value = getZoneDropdownOptionValue(zoneValue);
    option.textContent = getZoneDropdownOptionLabel(zoneValue);
    dropdown.appendChild(option);
  });

  const availableValues = new Set(zoneValues.map((zoneValue) => getZoneDropdownOptionValue(zoneValue)));
  dropdown.value =
    desiredValue === REFERENCE_ALL_ZONES_VALUE || availableValues.has(desiredValue)
      ? desiredValue || REFERENCE_ALL_ZONES_VALUE
      : REFERENCE_ALL_ZONES_VALUE;
  selectedZoneValue = dropdown.value || REFERENCE_ALL_ZONES_VALUE;
  dropdown.disabled = false;
}

function projectHasStructuredZones(projectName) {
  return collectProjectZones(projectName).length > 0;
}

function refreshZoneSuggestionList(datalistId, projectName) {
  const datalist = document.getElementById(datalistId);
  if (!datalist) return;

  const zones = collectProjectZones(projectName);
  datalist.innerHTML = '';
  zones.forEach((zone) => {
    const option = document.createElement('option');
    option.value = zone;
    datalist.appendChild(option);
  });
}

function collectProjectDocumentEntries(projectName, typeValue = '') {
  const project = normalizeReferenceDocumentIdentityPart(projectName);
  const normalizedType = normalizeTypeDocument(typeValue);
  const selectedZone = getCurrentSelectedZone();
  if (!project || !Array.isArray(records)) return [];

  const docsByKey = new Map();

  records.forEach((record) => {
    if (normalizeReferenceDocumentIdentityPart(record.NomProjet) !== project) return;
    if (
      normalizedType &&
      normalizeReferenceDocumentIdentityPart(record.Type_document) !==
        normalizeReferenceDocumentIdentityPart(normalizedType)
    ) return;
    if (!matchesReferenceZoneSelection(record.Zone, selectedZone)) return;

    const name = _norm(record.NomDocument);
    if (!name) return;

    const type = normalizeTypeDocument(record.Type_document);
    const numero = parseNumeroForStorage(record.NumeroDocument);
    const zone = normalizeZoneValue(record.Zone);
    const key = [
      normalizeReferenceDocumentIdentityPart(type),
      zone.toLocaleLowerCase('fr'),
      normalizeReferenceDocumentIdentityPart(numero),
      normalizeReferenceDocumentIdentityPart(name),
    ].join('||');

    if (docsByKey.has(key)) return;

    docsByKey.set(key, {
      name,
      numero,
      type,
      zone,
      label: makeDocLabel(name, numero),
      value: buildDocSelectValue({ numero, name, zone, type }),
    });
  });

  return Array.from(docsByKey.values()).sort((left, right) => {
    if (!normalizedType) {
      const leftRank = getDocumentTypeSortRank(left.type);
      const rightRank = getDocumentTypeSortRank(right.type);
      if (leftRank !== rightRank) return leftRank - rightRank;

      const typeCompare = normalizeTypeDocument(left.type).localeCompare(
        normalizeTypeDocument(right.type),
        'fr',
        { sensitivity: 'base', numeric: true }
      );
      if (typeCompare !== 0) return typeCompare;
    }

    const zoneLeft = formatZoneLabel(left.zone);
    const zoneRight = formatZoneLabel(right.zone);
    const sansZoneLeft = normalizeZoneValue(left.zone) ? 0 : 1;
    const sansZoneRight = normalizeZoneValue(right.zone) ? 0 : 1;

    if (sansZoneLeft !== sansZoneRight) {
      return sansZoneLeft - sansZoneRight;
    }

    const zoneCompare = zoneLeft.localeCompare(zoneRight, 'fr', { sensitivity: 'base', numeric: true });
    if (zoneCompare !== 0) return zoneCompare;

    const numeroLeft = numeroSortable(left.numero);
    const numeroRight = numeroSortable(right.numero);
    if (numeroLeft !== numeroRight) return numeroLeft - numeroRight;

    return left.name.localeCompare(right.name, 'fr', { sensitivity: 'base', numeric: true });
  });
}

function getCurrentSelectedType() {
  const dropdown = document.getElementById('thirdColumnDropdown');
  return normalizeTypeDocument(dropdown ? dropdown.value : selectedTypeValue);
}

function getDocumentTypeForProjectDoc(projectName, docName, zoneName, numeroValue, preferredTypeValue = '') {
  const project = normalizeReferenceDocumentIdentityPart(projectName);
  const documentName = normalizeReferenceDocumentIdentityPart(docName);
  const preferredType = normalizeTypeDocument(preferredTypeValue || getCurrentSelectedType());
  const normalizedZone = normalizeZoneValue(zoneName);
  const normalizedZoneKey = normalizeZoneMatchKey(normalizedZone);
  const normalizedNumero = parseNumeroForStorage(numeroValue);
  const zoneWasProvided = arguments.length >= 3;
  const numeroWasProvided = arguments.length >= 4;
  if (!project || !documentName || !Array.isArray(records)) return '';

  const match = records.find(record =>
    normalizeReferenceDocumentIdentityPart(record.NomProjet) === project &&
    normalizeReferenceDocumentIdentityPart(record.NomDocument) === documentName &&
    (!zoneWasProvided || normalizeZoneMatchKey(record.Zone) === normalizedZoneKey) &&
    (!numeroWasProvided ||
      normalizeReferenceDocumentIdentityPart(record.NumeroDocument) ===
        normalizeReferenceDocumentIdentityPart(normalizedNumero)) &&
    normalizeReferenceDocumentIdentityPart(record.Type_document) ===
      normalizeReferenceDocumentIdentityPart(preferredType)
  );

  return match ? normalizeTypeDocument(match.Type_document) : '';
}

const DEFAULT_DOCUMENT_TYPES = [
  'COFFRAGE',
  'ARMATURES',
  'COUPES',
  'D\u00C9MOLITION',
  'NDC',
];

let projetsTableCache = null;

function isDefaultDocumentType(type) {
  return DEFAULT_DOCUMENT_TYPES.includes(normalizeTypeDocument(type));
}

function parseProjectTypeDocValue(value) {
  const seen = new Set();
  return String(value ?? '')
    .split(/[;,\r\n]+/)
    .map((entry) => normalizeTypeDocument(entry))
    .filter((entry) => {
      if (!entry || isDefaultDocumentType(entry) || seen.has(entry)) return false;
      seen.add(entry);
      return true;
    });
}

function serializeProjectTypeDocValue(types) {
  const seen = new Set();
  return (types || [])
    .map((type) => normalizeTypeDocument(type))
    .filter((type) => {
      if (!type || isDefaultDocumentType(type) || seen.has(type)) return false;
      seen.add(type);
      return true;
    })
    .join('; ');
}

function getMatchingProjectRowIndexes(projectName, projetsTable = projetsTableCache) {
  if (!projetsTable) return [];
  const project = _norm(projectName);
  if (!project) return [];

  const names = Array.isArray(projetsTable.Nom_de_projet) ? projetsTable.Nom_de_projet : [];
  const indexes = [];
  names.forEach((value, index) => {
    if (_norm(value) === project) {
      indexes.push(index);
    }
  });
  return indexes;
}

function collectProjectCustomDocumentTypes(projectName, projetsTable = projetsTableCache) {
  const customTypes = [];
  const seen = new Set();
  const typeDocs = Array.isArray(projetsTable?.TypeDoc) ? projetsTable.TypeDoc : [];

  getMatchingProjectRowIndexes(projectName, projetsTable).forEach((index) => {
    parseProjectTypeDocValue(typeDocs[index]).forEach((type) => {
      if (seen.has(type)) return;
      seen.add(type);
      customTypes.push(type);
    });
  });

  return customTypes;
}

function collectPendingReferenceTypes() {
  const seen = new Set();
  return pendingReferenceDocuments
    .map((doc) => normalizeTypeDocument(doc?.type))
    .filter((type) => {
      if (!type || seen.has(type)) return false;
      seen.add(type);
      return true;
    });
}

function collectAvailableReferenceDocumentTypes(projectName, extraTypes = []) {
  const seen = new Set();
  const orderedTypes = [];

  [
    ...DEFAULT_DOCUMENT_TYPES,
    ...collectProjectCustomDocumentTypes(projectName),
    ...(extraTypes || [])
  ].forEach((type) => {
    const normalized = normalizeTypeDocument(type);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    orderedTypes.push(normalized);
  });

  return orderedTypes;
}

function getDocumentTypeSortRank(type) {
  const normalized = normalizeTypeDocument(type);
  const index = DEFAULT_DOCUMENT_TYPES.indexOf(normalized);
  return index === -1 ? DEFAULT_DOCUMENT_TYPES.length : index;
}

function compareZoneKeys(left, right) {
  const leftEmpty = normalizeZoneValue(left) ? 0 : 1;
  const rightEmpty = normalizeZoneValue(right) ? 0 : 1;
  if (leftEmpty !== rightEmpty) return leftEmpty - rightEmpty;
  return formatZoneLabel(left).localeCompare(formatZoneLabel(right), 'fr', {
    sensitivity: 'base',
    numeric: true,
  });
}

function appendDocumentOption(parent, entry) {
  const option = document.createElement('option');
  option.value = entry.value;
  option.text = entry.label;
  parent.appendChild(option);
}

function appendZoneOptions(parent, entries, withZoneSeparators = false) {
  const groupedEntries = new Map();
  entries.forEach((entry) => {
    const zoneKey = normalizeZoneMatchKey(entry.zone);
    if (!groupedEntries.has(zoneKey)) {
      groupedEntries.set(zoneKey, {
        zone: normalizeZoneValue(entry.zone),
        entries: [],
      });
    }
    groupedEntries.get(zoneKey).entries.push(entry);
  });

  const groupedZones = Array.from(groupedEntries.values()).sort((left, right) => compareZoneKeys(left.zone, right.zone));

  groupedZones.forEach((groupedZone) => {
    if (withZoneSeparators) {
      const separator = document.createElement('option');
      separator.disabled = true;
      separator.text = `--- ${formatZoneLabel(groupedZone.zone)} ---`;
      parent.appendChild(separator);
      groupedZone.entries.forEach((entry) => appendDocumentOption(parent, entry));
      return;
    }

    const group = document.createElement('optgroup');
    group.label = formatZoneLabel(groupedZone.zone);
    groupedZone.entries.forEach((entry) => appendDocumentOption(group, entry));
    parent.appendChild(group);
  });
}

function collectProjectDocumentTypes(projectName, extraTypes = []) {
  const project = _norm(projectName);
  const uniqueTypes = new Set();
  const orderedTypes = [];

  function pushType(type) {
    const normalized = normalizeTypeDocument(type);
    if (!normalized || uniqueTypes.has(normalized)) return;
    uniqueTypes.add(normalized);
    orderedTypes.push(normalized);
  }

  DEFAULT_DOCUMENT_TYPES.forEach(pushType);
  collectProjectCustomDocumentTypes(project).forEach(pushType);

  if (project && Array.isArray(records)) {
    records.forEach(record => {
      if (_norm(record.NomProjet) !== project) return;
      pushType(record.Type_document);
    });
  }

  (extraTypes || []).forEach(pushType);

  return orderedTypes;
}

function collectReferenceDocumentTypesFromRecords(projectName) {
  const project = normalizeReferenceDocumentIdentityPart(projectName);
  const seen = new Set();
  const types = [];

  if (!project || !Array.isArray(records)) return types;

  records.forEach(record => {
    if (normalizeReferenceDocumentIdentityPart(record.NomProjet) !== project) return;
    const type = normalizeTypeDocument(record.Type_document);
    const typeKey = normalizeReferenceDocumentIdentityPart(type);
    if (!typeKey || seen.has(typeKey)) return;
    seen.add(typeKey);
    types.push(type);
  });

  return types.sort((left, right) => {
    const rankDiff = getDocumentTypeSortRank(left) - getDocumentTypeSortRank(right);
    if (rankDiff !== 0) return rankDiff;
    return left.localeCompare(right, 'fr', { sensitivity: 'base', numeric: true });
  });
}

function populateTypeDocumentDropdown(selectedProject, preferredValue = '', extraTypes = []) {
  const dropdown = document.getElementById('thirdColumnDropdown');
  if (!dropdown) return;

  const project = _norm(selectedProject);
  const desiredValue = normalizeTypeDocument(preferredValue || selectedTypeValue);

  dropdown.innerHTML = '<option value="">Tous les types</option>';

  if (!project) {
    dropdown.disabled = true;
    dropdown.value = '';
    selectedTypeValue = '';
    return;
  }

  const types = collectProjectDocumentTypes(project, extraTypes);
  types.forEach(type => {
    const option = document.createElement('option');
    option.value = type;
    option.textContent = type;
    dropdown.appendChild(option);
  });

  dropdown.disabled = false;
  const hasDesired = desiredValue &&
    Array.from(dropdown.options).some(option => option.value === desiredValue);
  dropdown.value = hasDesired ? desiredValue : '';
  selectedTypeValue = dropdown.value;
}

let currentEmetteur = '';
let selectedRecordId = null;
let newTable = false; // Variable to track if a new table is being added
let newTableName = ''; // Variable to store the name of the new table
let newTableType = '';
let lastValidDocument = '';
const DOC_ADD_SPECIAL_VALUE = 'addDocuments';
const DEFAULT_REFERENCE_DOCUMENT_TYPE = 'NDC';
const DEFAULT_REFERENCE_DATE = '1900-01-01';
const REFERENCE_RETARD_DAY_MS = 86400000;
let pendingReferenceDocuments = [];

function parseReferenceRetardCalendarDate(value) {
  if (value == null || value === '') return null;

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : new Date(value);
  }

  if (typeof value === 'number') {
    const absValue = Math.abs(value);
    const timestamp = absValue >= 86400 && absValue < 1e11 ? value * 1000 : value;
    const date = new Date(timestamp);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const text = String(value).trim();
  if (!text) return null;

  const isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s].*)?$/);
  if (isoMatch) {
    const year = Number(isoMatch[1]);
    const month = Number(isoMatch[2]);
    const day = Number(isoMatch[3]);
    const date = new Date(year, month - 1, day);
    return (
      date.getFullYear() === year &&
      date.getMonth() === month - 1 &&
      date.getDate() === day
    )
      ? date
      : null;
  }

  const frMatch = text.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+.*)?$/);
  if (frMatch) {
    const day = Number(frMatch[1]);
    const month = Number(frMatch[2]);
    const year = Number(frMatch[3]);
    const date = new Date(year, month - 1, day);
    return (
      date.getFullYear() === year &&
      date.getMonth() === month - 1 &&
      date.getDate() === day
    )
      ? date
      : null;
  }

  const fallback = new Date(text);
  return Number.isNaN(fallback.getTime()) ? null : fallback;
}

function isEmptyReferenceRetardDate(date) {
  return (
    !(date instanceof Date) ||
    Number.isNaN(date.getTime()) ||
    (
      date.getFullYear() === 1900 &&
      date.getMonth() === 0 &&
      date.getDate() === 1
    )
  );
}

function getReferenceRetardCalendarMs(date) {
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
}

function computeReferenceRetardDays(recuValue, dateLimiteValue, currentDateValue = new Date()) {
  const recuDate = parseReferenceRetardCalendarDate(recuValue);
  const dateLimite = parseReferenceRetardCalendarDate(dateLimiteValue);
  const currentDate = parseReferenceRetardCalendarDate(currentDateValue);

  if (isEmptyReferenceRetardDate(dateLimite)) {
    return null;
  }

  const comparisonDate = isEmptyReferenceRetardDate(recuDate) ? currentDate : recuDate;
  if (isEmptyReferenceRetardDate(comparisonDate)) {
    return null;
  }

  const recuMs = getReferenceRetardCalendarMs(comparisonDate);
  const limiteMs = getReferenceRetardCalendarMs(dateLimite);
  if (recuMs <= limiteMs) {
    return null;
  }

  return Math.floor((recuMs - limiteMs) / REFERENCE_RETARD_DAY_MS);
}

function parseReferenceDurationLimit(value) {
  const text = String(value ?? '').trim();
  if (!text) return null;

  const numericValue = Number(text.replace(',', '.'));
  if (!Number.isFinite(numericValue) || !Number.isInteger(numericValue) || numericValue < 0) {
    return null;
  }

  return numericValue;
}

function formatReferenceDurationInput(value) {
  const durationWeeks = parseReferenceDurationLimit(value);
  return durationWeeks == null ? '' : String(durationWeeks);
}

function formatReferenceDateIso(value) {
  const date = parseReferenceRetardCalendarDate(value);
  if (isEmptyReferenceRetardDate(date)) return '';

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function subtractReferenceWeeksFromDate(date, weeks) {
  const durationWeeks = parseReferenceDurationLimit(weeks);
  if (!(date instanceof Date) || Number.isNaN(date.getTime()) || durationWeeks == null) {
    return null;
  }

  const nextDate = new Date(date);
  nextDate.setDate(nextDate.getDate() - durationWeeks * 7);
  return nextDate;
}

function isReferenceArmaturesTypeDoc(value) {
  return String(value ?? '').toLocaleUpperCase('fr').includes('ARMATURES');
}

function getPlanningRowObject(planningTable, index) {
  if (!planningTable || !Number.isInteger(index) || index < 0) return null;

  const row = {};
  Object.keys(planningTable).forEach((key) => {
    const column = planningTable[key];
    if (Array.isArray(column)) {
      row[key] = column[index];
    }
  });
  return row;
}

function getReferencePlanningSegmentStartDate(planningRow) {
  if (!planningRow) return null;

  if (isReferenceArmaturesTypeDoc(planningRow.Type_doc)) {
    return parseReferenceRetardCalendarDate(planningRow.Diff_coffrage);
  }

  return (
    parseReferenceRetardCalendarDate(planningRow.Date_limite) ||
    parseReferenceRetardCalendarDate(planningRow.Diff_coffrage) ||
    parseReferenceRetardCalendarDate(planningRow.Demarrages_travaux)
  );
}

async function fetchReferencePlanningTableForLimits() {
  try {
    const planningTableName = await resolvePlanningTableName();
    return await grist.docApi.fetchTable(planningTableName);
  } catch (error) {
    console.warn("Planning: impossible de calculer la date limite reference.", error);
    return null;
  }
}

function findPlanningRowForReferenceLimit(planningTable, {
  projectName = '',
  documentNumber = null,
  documentName = '',
  documentType = '',
  documentZone = '',
  service = '',
} = {}) {
  const idx = findPlanningIndex(
    planningTable,
    projectName,
    _norm(documentNumber),
    normalizeTypeDocument(documentType),
    normalizeZoneValue(documentZone),
    documentName,
    service
  );
  return getPlanningRowObject(planningTable, idx);
}

function buildReferenceLimitFields({
  planningTable = null,
  projectName = '',
  documentInfo = {},
  durationWeeks = '',
  useZeroWhenEmpty = false,
  service = '',
} = {}) {
  const parsedDuration = parseReferenceDurationLimit(durationWeeks);
  const usesVirtualZeroDuration =
    parsedDuration == null && Boolean(useZeroWhenEmpty) && !String(durationWeeks ?? '').trim();
  const effectiveDuration = usesVirtualZeroDuration ? 0 : parsedDuration;

  if (effectiveDuration == null) {
    return {
      DureeLimite: '',
      DateLimite: DEFAULT_REFERENCE_DATE,
    };
  }

  const planningRow = findPlanningRowForReferenceLimit(planningTable, {
    projectName,
    documentNumber: documentInfo?.numero ?? documentInfo?.documentNumber,
    documentName: documentInfo?.name ?? documentInfo?.documentName,
    documentType: documentInfo?.type ?? documentInfo?.documentType,
    documentZone: documentInfo?.zone ?? documentInfo?.documentZone,
    service: service || documentInfo?.service || documentInfo?.Service,
  });
  const segmentStartDate = getReferencePlanningSegmentStartDate(planningRow);
  const dateLimite = subtractReferenceWeeksFromDate(segmentStartDate, effectiveDuration);
  const dateLimiteIso = formatReferenceDateIso(dateLimite);

  return {
    DureeLimite: usesVirtualZeroDuration ? '' : parsedDuration,
    DateLimite: dateLimiteIso || DEFAULT_REFERENCE_DATE,
  };
}

function getReferenceDurationWeeksFromLimitDate(startDate, limitDate) {
  if (
    !(startDate instanceof Date) ||
    Number.isNaN(startDate.getTime()) ||
    isEmptyReferenceRetardDate(limitDate)
  ) {
    return null;
  }

  const startMs = getReferenceRetardCalendarMs(startDate);
  const limitMs = getReferenceRetardCalendarMs(limitDate);
  const diffDays = Math.round((startMs - limitMs) / REFERENCE_RETARD_DAY_MS);
  if (diffDays < 0 || diffDays % 7 !== 0) return null;
  return diffDays / 7;
}

function getReferenceDurationFromPlanningAndLimit({
  planningTable = null,
  projectName = '',
  documentInfo = {},
  dateLimite = '',
} = {}) {
  const planningRow = findPlanningRowForReferenceLimit(planningTable, {
    projectName,
    documentNumber: documentInfo?.numero ?? documentInfo?.documentNumber,
    documentName: documentInfo?.name ?? documentInfo?.documentName,
    documentType: documentInfo?.type ?? documentInfo?.documentType,
    documentZone: documentInfo?.zone ?? documentInfo?.documentZone,
  });
  const segmentStartDate = getReferencePlanningSegmentStartDate(planningRow);
  const limitDate = parseReferenceRetardCalendarDate(dateLimite);
  return getReferenceDurationWeeksFromLimitDate(segmentStartDate, limitDate);
}

async function resolveReferenceDurationInputValue(record) {
  const storedDuration = formatReferenceDurationInput(record?.DureeLimite);
  if (storedDuration) return storedDuration;
  if (!record) return '';

  const planningTable = await fetchReferencePlanningTableForLimits();
  const computedDuration = getReferenceDurationFromPlanningAndLimit({
    planningTable,
    projectName: record.NomProjet || selectedFirstValue,
    documentInfo: {
      numero: record.NumeroDocument,
      name: record.NomDocument,
      type: record.Type_document,
      zone: record.Zone,
    },
    dateLimite: record.DateLimite,
  });

  return computedDuration == null ? '' : String(computedDuration);
}

function getContextReferenceRecordForDefaults() {
  const numericSelectedId = Number(selectedRecordId);
  if (Number.isInteger(numericSelectedId) && numericSelectedId > 0) {
    const selectedRecord = records.find((record) => Number(record.id) === numericSelectedId);
    if (selectedRecord) return selectedRecord;
  }

  const selections = typeof getCurrentSelections === 'function' ? getCurrentSelections() : null;
  if (!selections) return null;
  const selectedProject = normalizeReferenceDocumentIdentityPart(selections.selectedProject);
  const selectedDocument = normalizeReferenceDocumentIdentityPart(selections.selectedTable);
  const selectedNumero = parseNumeroForStorage(selections.selectedDoc?.numero);
  const selectedZoneKey = normalizeZoneMatchKey(selections.selectedDoc?.zone);
  const selectedType = normalizeTypeDocument(selections.selectedDoc?.type || getCurrentSelectedType());

  return (records || []).find((record) => {
    if (normalizeReferenceDocumentIdentityPart(record.NomProjet) !== selectedProject) return false;
    if (normalizeReferenceDocumentIdentityPart(record.NomDocument) !== selectedDocument) return false;
    if (normalizeReferenceDocumentIdentityPart(record.Type_document) !== normalizeReferenceDocumentIdentityPart(selectedType)) return false;
    if (normalizeZoneMatchKey(record.Zone) !== selectedZoneKey) return false;
    if (selectedNumero != null && normalizeReferenceDocumentIdentityPart(record.NumeroDocument) !== normalizeReferenceDocumentIdentityPart(selectedNumero)) return false;
    return formatReferenceDurationInput(record.DureeLimite) || !isEmptyReferenceRetardDate(parseReferenceRetardCalendarDate(record.DateLimite));
  }) || null;
}

async function fillAddRowDefaultDurationFromContext({ force = false } = {}) {
  const durationInput = document.getElementById('dureeLimite');
  if (!(durationInput instanceof HTMLInputElement)) return;
  if (!force && String(durationInput.value || '').trim()) return;

  const contextRecord = getContextReferenceRecordForDefaults();
  const durationValue = await resolveReferenceDurationInputValue(contextRecord);
  if (durationValue && (force || !String(durationInput.value || '').trim())) {
    durationInput.value = durationValue;
  }
}

async function fillEditDurationFromRecord(record, { force = false } = {}) {
  const durationInput = document.getElementById('editDureeLimite');
  if (!(durationInput instanceof HTMLInputElement)) return;
  if (!force && String(durationInput.value || '').trim()) return;

  const valueBeforeLoading = durationInput.value;
  const durationValue = await resolveReferenceDurationInputValue(record);
  if (!force && durationInput.value !== valueBeforeLoading) return;
  if (force || durationValue) {
    durationInput.value = durationValue;
    durationInput.dataset.initialValue = durationValue;
  }
}

let referenceRetardReconcileInFlight = false;
let referenceRetardReconcilePending = false;
let referenceRetardReconcileTimer = 0;
let referenceRetardMidnightTimer = 0;

function toReferenceRetardStorageValue(value) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) && numericValue > 0
    ? String(Math.trunc(numericValue))
    : '';
}

function referenceRetardStoredValueMatches(currentValue, expectedValue) {
  return String(currentValue ?? '').trim() === toReferenceRetardStorageValue(expectedValue);
}

function getOpenReferenceDocumentRecords() {
  const selections = getCurrentSelections();
  if (!selections) return [];

  const selectedProject = normalizeReferenceDocumentIdentityPart(selections.selectedProject);
  const selectedDocument = normalizeReferenceDocumentIdentityPart(selections.selectedTable);
  const selectedNumero = parseNumeroForStorage(selections.selectedDoc?.numero);
  const selectedZoneKey = normalizeZoneMatchKey(selections.selectedDoc?.zone);
  const selectedType = normalizeTypeDocument(
    selections.selectedDoc?.type || getCurrentSelectedType()
  );
  if (!selectedProject || !selectedDocument) return [];

  return (Array.isArray(records) ? records : []).filter((record) => {
    if (normalizeReferenceDocumentIdentityPart(record?.NomProjet) !== selectedProject) return false;
    if (normalizeReferenceDocumentIdentityPart(record?.NomDocument) !== selectedDocument) return false;
    if (
      normalizeReferenceDocumentIdentityPart(record?.Type_document) !==
      normalizeReferenceDocumentIdentityPart(selectedType)
    ) return false;
    if (normalizeZoneMatchKey(record?.Zone) !== selectedZoneKey) return false;
    if (selectedNumero == null) return true;
    return (
      normalizeReferenceDocumentIdentityPart(record?.NumeroDocument) ===
      normalizeReferenceDocumentIdentityPart(selectedNumero)
    );
  });
}

function scheduleReferenceRetardReconciliation(delayMs = 0) {
  if (referenceRetardReconcileTimer) return;
  referenceRetardReconcileTimer = window.setTimeout(() => {
    referenceRetardReconcileTimer = 0;
    void reconcileReferenceRetards();
  }, Math.max(0, Number(delayMs) || 0));
}

function scheduleReferenceRetardMidnightRefresh() {
  if (referenceRetardMidnightTimer) {
    window.clearTimeout(referenceRetardMidnightTimer);
  }

  const now = new Date();
  const nextMidnight = new Date(now);
  nextMidnight.setHours(24, 0, 1, 0);
  referenceRetardMidnightTimer = window.setTimeout(() => {
    referenceRetardMidnightTimer = 0;
    scheduleReferenceRetardReconciliation();
    scheduleReferenceRetardMidnightRefresh();
  }, Math.max(1000, nextMidnight.getTime() - now.getTime()));
}

async function reconcileReferenceRetards() {
  if (referenceRetardReconcileInFlight) {
    referenceRetardReconcilePending = true;
    return;
  }

  referenceRetardReconcileInFlight = true;
  try {
    const currentRecords = getOpenReferenceDocumentRecords();
    if (!currentRecords.length) return;

    const today = new Date();
    const actions = [];

    currentRecords.forEach(record => {
      const recordId = Number(record?.id);
      if (!Number.isInteger(recordId) || recordId <= 0) return;

      const nextRetard = toReferenceRetardStorageValue(
        computeReferenceRetardDays(record?.Recu, record?.DateLimite, today)
      );
      if (referenceRetardStoredValueMatches(record?.Retard, nextRetard)) return;

      record.Retard = nextRetard;
      actions.push(['UpdateRecord', 'References2', recordId, { Retard: nextRetard }]);
    });

    if (!actions.length) return;

    populateTable();
    await applyUserActionsInChunks(actions);
  } catch (error) {
    console.error('Erreur synchronisation References2.Retard :', error);
  } finally {
    referenceRetardReconcileInFlight = false;
    if (referenceRetardReconcilePending) {
      referenceRetardReconcilePending = false;
      scheduleReferenceRetardReconciliation();
    }
  }
}

function withComputedReferenceRetard(fields) {
  return {
    ...fields,
    Retard: toReferenceRetardStorageValue(
      computeReferenceRetardDays(fields?.Recu, fields?.DateLimite)
    ),
  };
}

function hasOwnField(fields, key) {
  return Object.prototype.hasOwnProperty.call(fields || {}, key);
}

function isReferencesActionTableName(value) {
  const tableName = String(value || '').trim().toLowerCase();
  return tableName === 'references' || tableName === 'references2';
}

function getReferenceRecordById(recordId) {
  const numericId = Number(recordId);
  if (!Number.isInteger(numericId) || numericId <= 0) return null;

  let currentRecords = [];
  try {
    currentRecords = Array.isArray(records) ? records : [];
  } catch (_error) {
    currentRecords = [];
  }

  return currentRecords.find((record) => Number(record?.id) === numericId) || null;
}

function normalizeReferenceActionFieldsForRetard(action, fields) {
  if (!Array.isArray(action) || !fields || typeof fields !== 'object') {
    return fields;
  }

  const actionType = String(action[0] || '');
  if (!isReferencesActionTableName(action[1])) {
    return fields;
  }

  if (actionType === 'AddRecord') {
    return withComputedReferenceRetard(fields);
  }

  if (actionType !== 'UpdateRecord') {
    return fields;
  }

  const hasRecuUpdate = hasOwnField(fields, 'Recu');
  const hasDateLimiteUpdate = hasOwnField(fields, 'DateLimite');
  if (!hasRecuUpdate && !hasDateLimiteUpdate) {
    return hasOwnField(fields, 'Retard')
      ? { ...fields, Retard: toReferenceRetardStorageValue(fields.Retard) }
      : fields;
  }

  const existingRecord = getReferenceRecordById(action[2]);
  const recuValue = hasRecuUpdate ? fields.Recu : existingRecord?.Recu;
  const dateLimiteValue = hasDateLimiteUpdate ? fields.DateLimite : existingRecord?.DateLimite;
  const hasRecuValue = hasRecuUpdate || hasOwnField(existingRecord, 'Recu');
  const hasDateLimiteValue = hasDateLimiteUpdate || hasOwnField(existingRecord, 'DateLimite');

  if (!hasRecuValue || !hasDateLimiteValue) {
    return fields;
  }

  return {
    ...fields,
    Retard: toReferenceRetardStorageValue(
      computeReferenceRetardDays(recuValue, dateLimiteValue)
    ),
  };
}

async function refreshProjectsTableCache() {
  try {
    projetsTableCache = await grist.docApi.fetchTable('Projets2');
  } catch (error) {
    projetsTableCache = null;
    throw error;
  }
  return projetsTableCache;
}

function populateDocumentTypeDatalist(datalistId, types) {
  const datalist = document.getElementById(datalistId);
  if (!(datalist instanceof HTMLDataListElement)) return;
  datalist.innerHTML = '';
  (types || []).forEach((type) => {
    const option = document.createElement('option');
    option.value = type;
    datalist.appendChild(option);
  });
}

async function refreshReferenceTypeSuggestionLists(projectName = selectedFirstValue) {
  try {
    await refreshProjectsTableCache();
  } catch (error) {
    console.warn("Projets2: impossible de recharger les types de documents.", error);
  }

  const types = collectProjectDocumentTypes(
    projectName,
    collectPendingReferenceTypes()
  );

  [
    'documentTypeList',
    'multipleDocumentTypeList',
    'referenceManualDocTypeList',
    'referencePatternDocTypeList',
  ].forEach((listId) => populateDocumentTypeDatalist(listId, types));
}

function normalizeTypeDocumentInput(inputElement) {
  if (!(inputElement instanceof HTMLInputElement)) return;
  inputElement.value = normalizeTypeDocument(inputElement.value);
}

async function buildProjectTypeDocUpdateActions(projectName, types = []) {
  const project = _norm(projectName);
  if (!project) return [];

  let projetsTable;
  try {
    projetsTable = await refreshProjectsTableCache();
  } catch (error) {
    console.warn("Projets2: impossible de synchroniser TypeDoc.", error);
    return [];
  }

  if (!Object.prototype.hasOwnProperty.call(projetsTable, 'TypeDoc')) {
    return [];
  }

  const rowIndexes = getMatchingProjectRowIndexes(project, projetsTable);
  if (!rowIndexes.length) return [];

  const existingCustomTypes = collectProjectCustomDocumentTypes(project, projetsTable);
  const mergedTypeDocValue = serializeProjectTypeDocValue([
    ...existingCustomTypes,
    ...(types || []),
  ]);
  const currentTypeDocValue = serializeProjectTypeDocValue(existingCustomTypes);

  if (mergedTypeDocValue === currentTypeDocValue) {
    return [];
  }

  const ids = Array.isArray(projetsTable.id) ? projetsTable.id : [];
  if (!Array.isArray(projetsTable.TypeDoc)) {
    projetsTable.TypeDoc = [];
  }

  return rowIndexes
    .map((rowIndex) => {
      const recordId = ids[rowIndex];
      if (recordId == null) return null;
      projetsTable.TypeDoc[rowIndex] = mergedTypeDocValue;
      return ['UpdateRecord', 'Projets2', recordId, { TypeDoc: mergedTypeDocValue }];
    })
    .filter(Boolean);
}

function isSpecialDocumentOptionValue(value) {
  return _norm(value) === DOC_ADD_SPECIAL_VALUE;
}

function restoreLastDocumentSelection() {
  const listbox = document.getElementById('secondColumnListbox');
  if (!listbox) return;
  listbox.value = lastValidDocument || '';
  selectedSecondValue = lastValidDocument || '';

  if (selectedSecondValue) {
    const parsedDoc = parseDocValue(selectedSecondValue);
    selectedDocName = parsedDoc.name || '';
    selectedDocNumber = parseNumeroForStorage(parsedDoc.numero);
    selectedDocZone = normalizeZoneValue(parsedDoc.zone);
  } else {
    selectedDocName = '';
    selectedDocNumber = null;
    selectedDocZone = '';
  }

  if (selectedFirstValue && selectedSecondValue) {
    populateTable();
  } else if (!selectedSecondValue) {
    const tableBody = document.getElementById('tableBody');
    const tableHeader = document.getElementById('tableHeader');
    if (tableBody) tableBody.innerHTML = '';
    if (tableHeader) tableHeader.innerHTML = '';
  }
}

function queueNewDocumentSelection({ numero = null, name = '', zone = '', type = '' } = {}) {
  const normalizedName = _norm(name);
  const normalizedNumero = parseNumeroForStorage(numero);
  const normalizedZone = normalizeZoneValue(zone);
  const nextValue = buildDocSelectValue({
    numero: normalizedNumero,
    name: normalizedName,
    zone: normalizedZone,
    type,
  });

  newTable = true;
  newTableName = nextValue;
  newTableType = normalizeTypeDocument(type);
  selectedTypeValue = '';
  lastValidDocument = nextValue;
  selectedSecondValue = nextValue;
  selectedDocName = normalizedName;
  selectedDocNumber = normalizedNumero;
  selectedDocZone = normalizedZone;

  return nextValue;
}

function captureDocumentSelectionState() {
  return {
    newTable,
    newTableName,
    newTableType,
    lastValidDocument,
    selectedSecondValue,
    selectedDocName,
    selectedDocNumber,
    selectedDocZone,
  };
}

function restoreDocumentSelectionState(state = {}) {
  newTable = Boolean(state.newTable);
  newTableName = state.newTableName || '';
  newTableType = state.newTableType || '';
  lastValidDocument = state.lastValidDocument || '';
  selectedSecondValue = state.selectedSecondValue || '';
  selectedDocName = state.selectedDocName || '';
  selectedDocNumber = state.selectedDocNumber ?? null;
  selectedDocZone = state.selectedDocZone || '';
}

function normalizeReferenceDocumentNumberPadding(value) {
  const numericValue = Number.parseInt(value, 10);
  if (!Number.isFinite(numericValue)) return 3;
  return Math.max(3, numericValue);
}

function getReferenceDocumentBuilderDefaultType() {
  return '';
}

function normalizeAlphabetLetter(value, fallbackValue) {
  const text = String(value ?? '').trim().toLocaleUpperCase('fr');
  const match = text.match(/[A-Z]/);
  return match ? match[0] : fallbackValue;
}

function getAlphabetRangeValues(startValue, endValue) {
  const startLetter = normalizeAlphabetLetter(startValue, 'A');
  const endLetter = normalizeAlphabetLetter(endValue, 'E');
  const startCode = startLetter.charCodeAt(0);
  const endCode = endLetter.charCodeAt(0);

  if (startCode > endCode) {
    return {
      error: 'Erreur: "De" doit etre inferieur ou egal a "A".',
      values: [],
    };
  }

  const values = [];
  for (let code = startCode; code <= endCode; code += 1) {
    values.push(String.fromCharCode(code));
  }

  return { error: '', values };
}

function buildPendingReferenceDocumentIdentityKey(doc = {}) {
  return [
    normalizeReferenceDocumentIdentityPart(doc.numero),
    normalizeReferenceDocumentIdentityPart(normalizeTypeDocument(doc.type)),
  ].join('||');
}

function collectPendingReferenceZones() {
  const zones = [];
  const seen = new Set();
  pendingReferenceDocuments.forEach((doc) => {
    const zone = normalizeZoneValue(doc?.zone);
    const key = normalizeZoneMatchKey(zone);
    if (!zone || seen.has(key)) return;
    seen.add(key);
    zones.push(zone);
  });

  return zones.sort((left, right) => left.localeCompare(right, 'fr', {
    sensitivity: 'base',
    numeric: true,
  }));
}

function refreshReferenceZoneSuggestionLists() {
  const mergedZones = [...collectProjectZones(selectedFirstValue), ...collectPendingReferenceZones()];
  const uniqueZones = [];
  const seen = new Set();

  mergedZones.forEach((zone) => {
    const normalized = normalizeZoneValue(zone);
    const key = normalizeZoneMatchKey(normalized);
    if (!normalized || seen.has(key)) return;
    seen.add(key);
    uniqueZones.push(normalized);
  });

  ['referenceManualDocZoneList', 'referencePatternDocZoneList'].forEach((listId) => {
    const datalist = document.getElementById(listId);
    if (!datalist) return;
    datalist.innerHTML = '';
    uniqueZones.forEach((zone) => {
      const option = document.createElement('option');
      option.value = zone;
      datalist.appendChild(option);
    });
  });
}

function resolveReferenceDocumentZone(value, projectName = selectedFirstValue) {
  return resolveCanonicalZoneValue(value, [
    ...collectProjectZones(projectName),
    ...collectPendingReferenceZones(),
  ]);
}

function renderUnifiedPendingDocuments() {
  const container = document.getElementById('referenceDocumentsSelectionContainer');
  if (!container) return;
  refreshReferenceTypeSuggestionLists(selectedFirstValue);

  if (!pendingReferenceDocuments.length) {
    container.innerHTML = '<p class="reference-empty-state">Aucun document ajouté pour le moment.</p>';
    return;
  }

  const docsWithIndex = pendingReferenceDocuments.map((doc, index) => ({ ...doc, __index: index }));
  const groupedTypes = new Map();
  docsWithIndex.forEach((doc) => {
    const typeKey = normalizeTypeDocument(doc.type) || DEFAULT_REFERENCE_DOCUMENT_TYPE;
    if (!groupedTypes.has(typeKey)) groupedTypes.set(typeKey, []);
    groupedTypes.get(typeKey).push(doc);
  });

  const orderedTypes = collectProjectDocumentTypes(
    selectedFirstValue,
    Array.from(groupedTypes.keys())
  ).filter((typeKey) => groupedTypes.has(typeKey));

  container.innerHTML = '';

  orderedTypes.forEach((typeKey) => {
    const typeGroup = document.createElement('section');
    typeGroup.className = 'reference-type-group';

    const typeTitle = document.createElement('h4');
    typeTitle.className = 'reference-type-title';
    typeTitle.textContent = typeKey || 'Sans type';
    typeGroup.appendChild(typeTitle);

    const zoneGroups = new Map();
    groupedTypes.get(typeKey).forEach((doc) => {
      const zoneKey = normalizeZoneMatchKey(doc.zone);
      if (!zoneGroups.has(zoneKey)) {
        zoneGroups.set(zoneKey, {
          zone: normalizeZoneValue(doc.zone),
          docs: [],
        });
      }
      zoneGroups.get(zoneKey).docs.push(doc);
    });

    Array.from(zoneGroups.values()).sort((left, right) => compareZoneKeys(left.zone, right.zone)).forEach((zoneGroup) => {
      const zoneSection = document.createElement('div');
      zoneSection.className = 'reference-zone-group';

      const zoneTitle = document.createElement('h5');
      zoneTitle.className = 'reference-zone-title';
      zoneTitle.textContent = formatZoneLabel(zoneGroup.zone);
      zoneSection.appendChild(zoneTitle);

      const chipList = document.createElement('div');
      chipList.className = 'reference-chip-list';

      zoneGroup.docs
        .slice()
        .sort((left, right) => {
          const numeroLeft = parseNumeroForStorage(left.numero);
          const numeroRight = parseNumeroForStorage(right.numero);
          const sortLeft = numeroSortable(numeroLeft);
          const sortRight = numeroSortable(numeroRight);
          if (sortLeft !== sortRight) return sortLeft - sortRight;
          return _norm(left.name).localeCompare(_norm(right.name), 'fr', {
            sensitivity: 'base',
            numeric: true,
          });
        })
        .forEach((doc) => {
          const chip = document.createElement('div');
          chip.className = 'reference-doc-chip';

          const numeroSpan = document.createElement('span');
          numeroSpan.className = 'reference-doc-chip-numero';
          numeroSpan.textContent = _norm(doc.numero) || '-';

          const textSpan = document.createElement('span');
          textSpan.className = 'reference-doc-chip-text';
          textSpan.textContent = _norm(doc.name);

          const deleteBtn = document.createElement('button');
          deleteBtn.type = 'button';
          deleteBtn.className = 'reference-doc-chip-delete';
          deleteBtn.dataset.index = String(doc.__index);
          deleteBtn.textContent = '×';
          deleteBtn.title = 'Supprimer ce document';

          chip.appendChild(numeroSpan);
          chip.appendChild(textSpan);
          chip.appendChild(deleteBtn);
          chipList.appendChild(chip);
        });

      zoneSection.appendChild(chipList);
      typeGroup.appendChild(zoneSection);
    });

    container.appendChild(typeGroup);
  });

  container.querySelectorAll('.reference-doc-chip-delete').forEach((button) => {
    button.addEventListener('click', (event) => {
      const index = Number.parseInt(event.currentTarget.dataset.index, 10);
      if (!Number.isFinite(index)) return;
      pendingReferenceDocuments.splice(index, 1);
      renderUnifiedPendingDocuments();
      refreshReferenceZoneSuggestionLists();
    });
  });
}

function addUnifiedPendingDocuments(documents) {
  const seen = new Set(pendingReferenceDocuments.map((doc) => buildPendingReferenceDocumentIdentityKey(doc)));

  documents.forEach((doc) => {
    const nextDoc = {
      name: _norm(doc?.name || doc?.documentName),
      numero: _norm(doc?.numero || doc?.documentNumber),
      type: normalizeTypeDocument(doc?.type || doc?.documentType || DEFAULT_REFERENCE_DOCUMENT_TYPE),
      zone: resolveReferenceDocumentZone(doc?.zone || doc?.documentZone),
    };

    if (!nextDoc.name || !nextDoc.numero) return;

    const key = buildPendingReferenceDocumentIdentityKey(nextDoc);
    if (seen.has(key)) return;
    seen.add(key);
    pendingReferenceDocuments.push(nextDoc);
  });

  renderUnifiedPendingDocuments();
  refreshReferenceZoneSuggestionLists();
}

function getReferencePatternNameValues() {
  const alphaEnabled = document.getElementById('referencePatternAlphaEnabled')?.checked;
  if (alphaEnabled) {
    return getAlphabetRangeValues(
      document.getElementById('referencePatternAlphaStart')?.value,
      document.getElementById('referencePatternAlphaEnd')?.value
    );
  }

  const start = Number.parseInt(document.getElementById('referencePatternStart')?.value, 10) || 0;
  const end = Number.parseInt(document.getElementById('referencePatternEnd')?.value, 10) || 0;
  const padding = Number.parseInt(document.getElementById('referencePatternPadding')?.value, 10) || 0;

  if (start > end) {
    return {
      error: 'Erreur: "De" doit etre inferieur ou egal a "A".',
      values: [],
    };
  }

  const values = [];
  for (let index = start; index <= end; index += 1) {
    values.push(padding > 0 ? String(index).padStart(padding, '0') : String(index));
  }

  return { error: '', values };
}

function generateReferencePatternDocuments(prefix, suffix, nameValues, numeroStart, numeroStep, numeroPadding, type, zone = '') {
  const docs = [];
  let currentNumero = numeroStart;
  const effectiveNumeroPadding = normalizeReferenceDocumentNumberPadding(numeroPadding);

  nameValues.forEach((nameValue) => {
    let numero = String(currentNumero);
    if (effectiveNumeroPadding > 0) {
      numero = numero.padStart(effectiveNumeroPadding, '0');
    }

    docs.push({
      name: `${prefix}${nameValue}${suffix}`,
      numero,
      type: normalizeTypeDocument(type),
      zone: resolveReferenceDocumentZone(zone),
    });
    currentNumero += numeroStep;
  });

  return docs;
}

function updateReferencePatternPreview() {
  const prefix = document.getElementById('referencePatternPrefix')?.value || '';
  const suffix = document.getElementById('referencePatternSuffix')?.value || '';
  const numeroStart = Number.parseInt(document.getElementById('referenceNumeroStart')?.value, 10) || 0;
  const numeroStep = Number.parseInt(document.getElementById('referenceNumeroStep')?.value, 10) || 1;
  const numeroPadding = normalizeReferenceDocumentNumberPadding(document.getElementById('referenceNumeroPadding')?.value);
  const type = normalizeTypeDocument(document.getElementById('referencePatternDocType')?.value || '');
  const zone = normalizeZoneValue(document.getElementById('referencePatternDocZone')?.value || '');
  const previewBody = document.getElementById('referencePatternPreviewBody');
  const patternValues = getReferencePatternNameValues();
  if (!previewBody) return;

  if (patternValues.error) {
    previewBody.innerHTML = '<tr><td colspan="4" style="color: red;">(Erreur: "De" doit être inférieur ou égal à "À".)</td></tr>';
    return;
  }

  const docs = generateReferencePatternDocuments(
    prefix,
    suffix,
    patternValues.values.slice(0, 10),
    numeroStart,
    numeroStep,
    numeroPadding,
    type,
    zone
  );

  if (!docs.length) {
    previewBody.innerHTML = '<tr><td colspan="4">(Aucun aperçu)</td></tr>';
    return;
  }

  previewBody.innerHTML = docs.map((doc) => (
    `<tr><td>${doc.numero}</td><td>${doc.name}</td><td>${doc.type}</td><td>${formatZoneLabel(doc.zone)}</td></tr>`
  )).join('') + (patternValues.values.length > 10 ? '<tr><td>...</td><td>...</td><td>...</td><td>...</td></tr>' : '');
}

function setReferenceDocsBuilderTab(tabName) {
  const normalizedTab = tabName === 'pattern' ? 'pattern' : 'manual';
  document.querySelectorAll('.reference-tab-btn').forEach((button) => {
    button.classList.toggle('active', button.dataset.referenceTab === normalizedTab);
  });

  const manualTab = document.getElementById('referenceTabManual');
  const patternTab = document.getElementById('referenceTabPattern');
  if (manualTab) manualTab.style.display = normalizedTab === 'manual' ? 'block' : 'none';
  if (patternTab) patternTab.style.display = normalizedTab === 'pattern' ? 'block' : 'none';

  if (normalizedTab === 'pattern') {
    updateReferencePatternPreview();
  }
}

function resetReferenceDocsBuilderFields() {
  const manualZone = document.getElementById('referenceManualDocZone');
  const manualType = document.getElementById('referenceManualDocType');
  const manualName = document.getElementById('referenceManualDocName');
  const manualNumero = document.getElementById('referenceManualDocNumero');
  if (manualZone) manualZone.value = '';
  if (manualType) manualType.value = '';
  if (manualName) manualName.value = '';
  if (manualNumero) manualNumero.value = '';

  const patternZone = document.getElementById('referencePatternDocZone');
  const patternType = document.getElementById('referencePatternDocType');
  const patternPrefix = document.getElementById('referencePatternPrefix');
  const patternSuffix = document.getElementById('referencePatternSuffix');
  const patternStart = document.getElementById('referencePatternStart');
  const patternEnd = document.getElementById('referencePatternEnd');
  const patternPadding = document.getElementById('referencePatternPadding');
  const alphaEnabled = document.getElementById('referencePatternAlphaEnabled');
  const alphaStart = document.getElementById('referencePatternAlphaStart');
  const alphaEnd = document.getElementById('referencePatternAlphaEnd');
  const numberRangeFields = document.getElementById('referencePatternNumberRangeFields');
  const alphaRangeFields = document.getElementById('referencePatternAlphaRangeFields');
  const numeroStart = document.getElementById('referenceNumeroStart');
  const numeroStep = document.getElementById('referenceNumeroStep');
  const numeroPadding = document.getElementById('referenceNumeroPadding');

  if (patternZone) patternZone.value = '';
  if (patternType) patternType.value = '';
  if (patternPrefix) patternPrefix.value = '';
  if (patternSuffix) patternSuffix.value = '';
  if (patternStart) patternStart.value = '1';
  if (patternEnd) patternEnd.value = '5';
  if (patternPadding) patternPadding.value = '0';
  if (alphaEnabled) alphaEnabled.checked = false;
  if (alphaStart) alphaStart.value = 'A';
  if (alphaEnd) alphaEnd.value = 'E';
  if (numberRangeFields) numberRangeFields.hidden = false;
  if (alphaRangeFields) alphaRangeFields.hidden = true;
  if (numeroStart) numeroStart.value = '1';
  if (numeroStep) numeroStep.value = '1';
  if (numeroPadding) numeroPadding.value = '3';

  setReferenceDocsBuilderTab('manual');
  refreshReferenceZoneSuggestionLists();
  updateReferencePatternPreview();
}

function closeReferenceDocsBuilderModal() {
  const modal = document.getElementById('referenceDocsBuilderModal');
  if (!modal) return;
  modal.hidden = true;
}

function openReferenceDocsBuilderModal() {
  const modal = document.getElementById('referenceDocsBuilderModal');
  if (!modal) return;
  resetReferenceDocsBuilderFields();
  void refreshReferenceTypeSuggestionLists(selectedFirstValue);
  modal.hidden = false;
}

function collectSelectedEmittersFromContainer(containerId) {
  return Array.from(document.querySelectorAll(`#${containerId} input[type="checkbox"]:checked`))
    .filter((checkbox) => {
      const checkboxId = String(checkbox?.id || '');
      return checkbox?.dataset?.selectAll !== 'true' &&
        checkboxId !== 'selectAllEmitters' &&
        !checkboxId.endsWith('_selectAll');
    })
    .map((checkbox) => {
      const nextInput = checkbox.nextElementSibling;
      if (nextInput && nextInput.tagName === 'INPUT' && nextInput.type === 'text') {
        const customValue = nextInput.value.trim();
        return customValue || null;
      }
      return checkbox.value;
    })
    .filter(Boolean);
}

async function populateReferenceUnifiedEmetteurDropdown() {
  const selectedProject = selectedFirstValue;
  if (!selectedProject) return;

  const defaultEmetteurs = await getDefaultEmetteurs();
  const projectEmetteurs = [...new Set(
    records
      .filter((record) => _norm(record.NomProjet) === _norm(selectedProject))
      .map((record) => record.Emetteur)
      .filter(Boolean)
  )].sort((left, right) => left.localeCompare(right, 'fr', { sensitivity: 'base' }));

  populateEmetteurDropdownForContainer('referenceUnifiedEmetteurDropdown', projectEmetteurs, defaultEmetteurs);
}

async function resetUnifiedAddDocumentsDialog() {
  pendingReferenceDocuments = [];
  await refreshReferenceTypeSuggestionLists(selectedFirstValue);
  closeReferenceDocsBuilderModal();
  renderUnifiedPendingDocuments();
  refreshReferenceZoneSuggestionLists();
  resetReferenceDocsBuilderFields();

  const defaultDurationInput = document.getElementById('referenceUnifiedDefaultDureeLimite');
  if (defaultDurationInput) defaultDurationInput.value = '';

  await populateReferenceUnifiedEmetteurDropdown();
}

async function openUnifiedAddDocumentsDialog() {
  if (!selectedFirstValue) {
    resetZoneDropdown(true);
    alert("Veuillez sélectionner un projet avant d'ajouter des documents.");
    restoreLastDocumentSelection();
    return;
  }

  await resetUnifiedAddDocumentsDialog();
  const dialog = document.getElementById('addDocumentsUnifiedDialog');
  if (dialog) dialog.showModal();
}

async function createDocumentsBatch({
  projectName,
  documents,
  selectedEmitters,
  defaultDureeLimite = '',
}) {
  const normalizedProject = _norm(projectName || selectedFirstValue);
  if (!normalizedProject) {
    throw new Error("Aucun projet sélectionné.");
  }

  const normalizedEmitters = (selectedEmitters || []).map((value) => _norm(value)).filter(Boolean);
  if (!normalizedEmitters.length) {
    throw new Error("Veuillez sélectionner au moins un émetteur.");
  }

  const uniqueDocuments = [];
  const seenDocuments = new Set();
  (documents || []).forEach((doc) => {
    const normalizedDoc = {
      documentNumber: _norm(doc?.documentNumber ?? doc?.numero),
      documentName: _norm(doc?.documentName ?? doc?.name),
      documentType: normalizeTypeDocument(doc?.documentType ?? doc?.type ?? DEFAULT_REFERENCE_DOCUMENT_TYPE),
      documentZone: resolveReferenceDocumentZone(doc?.documentZone ?? doc?.zone, normalizedProject),
    };

    if (!normalizedDoc.documentNumber || !normalizedDoc.documentName || !normalizedDoc.documentType) return;

    const key = [
      normalizeReferenceDocumentIdentityPart(normalizedDoc.documentNumber),
      normalizeReferenceDocumentIdentityPart(normalizedDoc.documentType),
    ].join('||');

    if (seenDocuments.has(key)) {
      throw new Error(
        `Le numero de document "${normalizedDoc.documentNumber}" est saisi plusieurs fois pour le type "${normalizedDoc.documentType}".`
      );
    }
    seenDocuments.add(key);
    uniqueDocuments.push(normalizedDoc);
  });

  if (!uniqueDocuments.length) {
    throw new Error("Veuillez ajouter au moins un document complet.");
  }
  const serviceValue = await getTeamService();
  await assertReferenceDocumentIdentitiesAvailable(
    normalizedProject,
    uniqueDocuments.map((doc) => ({
      number: doc.documentNumber,
      name: doc.documentName,
      type: doc.documentType,
    })),
    serviceValue
  );

  const safeDefaultDureeLimite = _norm(defaultDureeLimite);
  if (safeDefaultDureeLimite && parseReferenceDurationLimit(safeDefaultDureeLimite) == null) {
    throw new Error("La duree limite par defaut doit etre un nombre entier de semaines.");
  }
  const actions = [];
  let planningTableForLimits = null;

  try {
    const plansTableName = await resolveListePlanTableName();
    const plans = await grist.docApi.fetchTable(plansTableName);
    const pendingPlanAdds = new Set();

    uniqueDocuments.forEach((doc) => {
      const idxPlan = findListePlanIndex(
        plans,
        normalizedProject,
        doc.documentNumber,
        doc.documentType,
        doc.documentZone,
        doc.documentName,
        serviceValue
      );
      const key = [
        normalizeReferenceDocumentIdentityPart(normalizedProject),
        normalizeReferenceDocumentIdentityPart(doc.documentNumber),
        normalizeReferenceDocumentIdentityPart(doc.documentType),
        normalizeServiceMatchKey(serviceValue),
      ].join('||');

      if (idxPlan >= 0) {
        actions.push(['UpdateRecord', plansTableName, plans.id[idxPlan], {
          Type_document: doc.documentType,
          Zone: doc.documentZone,
          Designation: doc.documentName,
        }]);
      } else if (!pendingPlanAdds.has(key)) {
        actions.push(['AddRecord', plansTableName, null, {
          Nom_projet: normalizedProject,
          NumeroDocument: doc.documentNumber,
          Type_document: doc.documentType,
          Zone: doc.documentZone,
          Designation: doc.documentName,
          Service: serviceValue,
        }]);
        pendingPlanAdds.add(key);
      }
    });
  } catch (error) {
    throw new Error(`ListePlan: impossible de preparer les documents. ${error.message || error}`);
  }

  try {
    const planningTableName = await resolvePlanningTableName();
    const planning = await grist.docApi.fetchTable(planningTableName);
    planningTableForLimits = planning;
    const queuedZoneAnchors = new Set();
    const pendingPlanningAdds = new Set();

    uniqueDocuments.forEach((doc) => {
      const zoneKey = normalizeZoneMatchKey(doc.documentZone);
      if (zoneKey && !queuedZoneAnchors.has(zoneKey)) {
        const planningZoneAnchorAction = buildPlanningZoneAnchorActionIfMissing(
          planningTableName,
          planning,
          normalizedProject,
          doc.documentZone,
          serviceValue
        );
        if (planningZoneAnchorAction) {
          actions.push(planningZoneAnchorAction);
        }
        queuedZoneAnchors.add(zoneKey);
      }

      const idxPlanning = findPlanningIndex(
        planning,
        normalizedProject,
        doc.documentNumber,
        doc.documentType,
        doc.documentZone,
        doc.documentName,
        serviceValue
      );
      const planningKey = [
        normalizeReferenceDocumentIdentityPart(normalizedProject),
        normalizeReferenceDocumentIdentityPart(doc.documentNumber),
        normalizeReferenceDocumentIdentityPart(doc.documentType),
        normalizeServiceMatchKey(serviceValue),
      ].join('||');

      if (idxPlanning >= 0) {
        actions.push([
          'UpdateRecord',
          planningTableName,
          planning.id[idxPlanning],
          buildPlanningDocumentUpdateFields(planning, {
            taskName: doc.documentName,
            typeDoc: doc.documentType,
            zoneStr: doc.documentZone,
          }),
        ]);
      } else if (!pendingPlanningAdds.has(planningKey)) {
        actions.push([
          'AddRecord',
          planningTableName,
          null,
          buildPlanningDocumentAddFields(planning, {
            projectName: normalizedProject,
            numeroDocStr: doc.documentNumber,
            taskName: doc.documentName,
            typeDoc: doc.documentType,
            zoneStr: doc.documentZone,
            service: serviceValue,
          }),
        ]);
        pendingPlanningAdds.add(planningKey);
      }
    });
  } catch (error) {
    throw new Error(`Planning: impossible de preparer les documents. ${error.message || error}`);
  }

  uniqueDocuments.forEach((doc) => {
    normalizedEmitters.forEach((emetteur) => {
      actions.push(['AddRecord', 'References2', null, withComputedReferenceRetard({
        NomProjet: normalizedProject,
        NomDocument: doc.documentName,
        NumeroDocument: doc.documentNumber,
        Type_document: doc.documentType,
        Zone: doc.documentZone,
        Emetteur: emetteur,
        Reference: '_',
        Indice: '-',
        Recu: DEFAULT_REFERENCE_DATE,
        DescriptionObservations: 'EN ATTENTE',
        ...buildReferenceLimitFields({
          planningTable: planningTableForLimits,
          projectName: normalizedProject,
          documentInfo: doc,
          durationWeeks: safeDefaultDureeLimite,
          service: serviceValue,
        }),
        Service: serviceValue,
      })]);
    });
  });

  const typeDocActions = await buildProjectTypeDocUpdateActions(
    normalizedProject,
    uniqueDocuments.map((doc) => doc.documentType)
  );
  typeDocActions.forEach((action) => actions.unshift(action));

  const previousSelectionState = captureDocumentSelectionState();
  const lastDoc = uniqueDocuments[uniqueDocuments.length - 1];
  const lastDocNumber = parseNumeroForStorage(lastDoc.documentNumber);
  const lastDocValue = queueNewDocumentSelection({
    numero: lastDocNumber,
    name: lastDoc.documentName,
    zone: lastDoc.documentZone,
    type: lastDoc.documentType,
  });

  try {
    await applyUserActionsInChunks(actions);
  } catch (error) {
    restoreDocumentSelectionState(previousSelectionState);
    throw error;
  }
  await refreshReferenceTypeSuggestionLists(normalizedProject);
  selectedTypeValue = '';
  restoreLastDocumentSelection();

  return {
    lastDoc,
    lastDocValue,
  };
}

function setupUnifiedAddDocumentsUi() {
  if (window.__referenceUnifiedAddDocsSetup) return;
  window.__referenceUnifiedAddDocsSetup = true;

  const builderModal = document.getElementById('referenceDocsBuilderModal');
  const openBuilderBtn = document.getElementById('openReferenceDocsBuilderBtn');
  const closeBuilderBtn = document.getElementById('closeReferenceDocsBuilderBtn');
  const unifiedDialog = document.getElementById('addDocumentsUnifiedDialog');
  const unifiedForm = document.getElementById('addDocumentsUnifiedForm');
  const confirmUnifiedBtn = document.getElementById('confirmAddDocumentsUnifiedButton');
  const cancelUnifiedBtn = document.getElementById('cancelAddDocumentsUnifiedButton');
  const manualZoneInput = document.getElementById('referenceManualDocZone');
  const manualNameInput = document.getElementById('referenceManualDocName');
  const manualNumeroInput = document.getElementById('referenceManualDocNumero');
  const manualTypeInput = document.getElementById('referenceManualDocType');
  const addManualBtn = document.getElementById('addReferenceManualDocBtn');
  const patternZoneInput = document.getElementById('referencePatternDocZone');
  const patternTypeInput = document.getElementById('referencePatternDocType');
  const addPatternBtn = document.getElementById('addReferencePatternDocsBtn');
  const alphaEnabledInput = document.getElementById('referencePatternAlphaEnabled');
  const alphaStartInput = document.getElementById('referencePatternAlphaStart');
  const alphaEndInput = document.getElementById('referencePatternAlphaEnd');
  const numberRangeFields = document.getElementById('referencePatternNumberRangeFields');
  const alphaRangeFields = document.getElementById('referencePatternAlphaRangeFields');

  function updateReferencePatternRangeMode() {
    const isAlphabetMode = Boolean(alphaEnabledInput?.checked);
    if (numberRangeFields) numberRangeFields.hidden = isAlphabetMode;
    if (alphaRangeFields) alphaRangeFields.hidden = !isAlphabetMode;
    updateReferencePatternPreview();
  }

  [
    document.getElementById('documentType'),
    document.getElementById('multipleDocumentType'),
    manualTypeInput,
    patternTypeInput,
  ].forEach((inputElement) => {
    if (!inputElement) return;
    inputElement.addEventListener('click', () => {
      try {
        inputElement.showPicker?.();
      } catch (_error) {
        // Le navigateur affichera naturellement la datalist.
      }
    });
    ['change', 'blur'].forEach((eventName) => {
      inputElement.addEventListener(eventName, () => {
        normalizeTypeDocumentInput(inputElement);
        if (inputElement === patternTypeInput) {
          updateReferencePatternPreview();
        }
      });
    });
  });

  if (openBuilderBtn) {
    openBuilderBtn.addEventListener('click', () => {
      openReferenceDocsBuilderModal();
    });
  }

  if (closeBuilderBtn) {
    closeBuilderBtn.addEventListener('click', () => {
      closeReferenceDocsBuilderModal();
    });
  }

  document.querySelectorAll('.reference-tab-btn').forEach((button) => {
    button.addEventListener('click', () => {
      setReferenceDocsBuilderTab(button.dataset.referenceTab);
    });
  });

  [
    'referencePatternPrefix',
    'referencePatternSuffix',
    'referencePatternStart',
    'referencePatternEnd',
    'referencePatternPadding',
    'referencePatternDocType',
    'referencePatternDocZone',
    'referencePatternAlphaStart',
    'referencePatternAlphaEnd',
    'referenceNumeroStart',
    'referenceNumeroStep',
    'referenceNumeroPadding',
  ].forEach((inputId) => {
    const element = document.getElementById(inputId);
    if (!element) return;
    element.addEventListener('input', updateReferencePatternPreview);
    element.addEventListener('change', updateReferencePatternPreview);
  });

  if (alphaEnabledInput) {
    alphaEnabledInput.addEventListener('change', updateReferencePatternRangeMode);
  }

  if (addManualBtn) {
    addManualBtn.addEventListener('click', () => {
      const docNames = (manualNameInput?.value || '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
      const docNumeros = (manualNumeroInput?.value || '')
        .split(',')
        .map((value) => value.trim());
      const documentType = normalizeTypeDocument(manualTypeInput?.value);
      const documentZone = resolveReferenceDocumentZone(manualZoneInput?.value || '');

      if (!docNames.length) {
        alert("Veuillez renseigner au moins un nom de document.");
        return;
      }

      if (!documentType) {
        alert("Veuillez renseigner un type de document.");
        manualTypeInput?.focus();
        return;
      }

      if (docNumeros.length < docNames.length || docNames.some((_, index) => !_norm(docNumeros[index]))) {
        alert("Veuillez renseigner un numéro pour chaque document.");
        return;
      }

      const docs = docNames.map((name, index) => ({
        name,
        numero: _norm(docNumeros[index]),
        type: documentType,
        zone: documentZone,
      }));

      addUnifiedPendingDocuments(docs);
      closeReferenceDocsBuilderModal();
    });
  }

  if (manualZoneInput) {
    manualZoneInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        manualNameInput?.focus();
      }
    });
  }

  if (manualNameInput) {
    manualNameInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        manualNumeroInput?.focus();
      }
    });
  }

  if (manualNumeroInput) {
    manualNumeroInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        addManualBtn?.click();
      }
    });
  }

  if (addPatternBtn) {
    addPatternBtn.addEventListener('click', () => {
      const prefix = document.getElementById('referencePatternPrefix')?.value || '';
      const suffix = document.getElementById('referencePatternSuffix')?.value || '';
      const patternValues = getReferencePatternNameValues();
      const numeroStart = Number.parseInt(document.getElementById('referenceNumeroStart')?.value, 10) || 0;
      const numeroStep = Number.parseInt(document.getElementById('referenceNumeroStep')?.value, 10) || 1;
      const numeroPadding = normalizeReferenceDocumentNumberPadding(document.getElementById('referenceNumeroPadding')?.value);
      const documentType = normalizeTypeDocument(patternTypeInput?.value);
      const documentZone = resolveReferenceDocumentZone(patternZoneInput?.value || '');

      if (!documentType) {
        alert("Veuillez renseigner un type de document.");
        patternTypeInput?.focus();
        return;
      }

      if (patternValues.error) {
        alert('Erreur: "De" doit être inférieur ou égal à "À".');
        return;
      }

      addUnifiedPendingDocuments(generateReferencePatternDocuments(
        prefix,
        suffix,
        patternValues.values,
        numeroStart,
        numeroStep,
        numeroPadding,
        documentType,
        documentZone
      ));
      closeReferenceDocsBuilderModal();
    });
  }

  if (cancelUnifiedBtn) {
    cancelUnifiedBtn.addEventListener('click', () => {
      unifiedDialog?.close();
      closeReferenceDocsBuilderModal();
      restoreLastDocumentSelection();
    });
  }

  async function confirmUnifiedAddDocuments() {
    if (confirmUnifiedBtn) confirmUnifiedBtn.disabled = true;

    try {
      await createDocumentsBatch({
        projectName: selectedFirstValue,
        documents: pendingReferenceDocuments,
        selectedEmitters: collectSelectedEmittersFromContainer('referenceUnifiedEmetteurDropdown'),
        defaultDureeLimite: document.getElementById('referenceUnifiedDefaultDureeLimite')?.value || '',
      });

      unifiedDialog?.close();
      closeReferenceDocsBuilderModal();
    } catch (error) {
      console.error("Erreur lors de l'ajout des documents :", error);
      alert(error?.message || "Une erreur s'est produite lors de l'ajout des documents.");
    } finally {
      if (confirmUnifiedBtn) confirmUnifiedBtn.disabled = false;
    }
  }

  if (confirmUnifiedBtn) {
    confirmUnifiedBtn.addEventListener('click', () => {
      confirmUnifiedAddDocuments();
    });
  }

  if (unifiedForm) {
    unifiedForm.noValidate = true;
    unifiedForm.addEventListener('submit', (event) => {
      event.preventDefault();
      confirmUnifiedAddDocuments();
    });
  }

  if (unifiedDialog) {
    unifiedDialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      unifiedDialog.close();
      closeReferenceDocsBuilderModal();
      restoreLastDocumentSelection();
    });

    unifiedDialog.addEventListener('close', () => {
      closeReferenceDocsBuilderModal();
    });
  }
}

// Ready Grist
grist.ready();
setupUnifiedAddDocumentsUi();
renderUnifiedPendingDocuments();
scheduleReferenceRetardMidnightRefresh();

// Variable globale pour stocker les enregistrements de la table "Team"
let teamRecords = [];

// Lorsque les enregistrements de la table sont disponibles, on les stocke
grist.onRecords((records, tableId) => {
  if (tableId === "Team") {
    teamRecords = records;
    console.log("Team records loaded :", teamRecords);
  }
});

async function refreshProjectsDropdownFromProjets() {
  try {
    const projets = await refreshProjectsTableCache();
    const ids = Array.isArray(projets.id) ? projets.id : [];
    const numbers = Array.isArray(projets.Numero_de_projet) ? projets.Numero_de_projet : [];
    const names = Array.isArray(projets.Nom_de_projet) ? projets.Nom_de_projet : [];
    _projectsData = ids
      .map((id, i) => ({
        id: Number(id),
        number: String(numbers[i] || '').trim(),
        name: String(names[i] || '').trim(),
      }))
      .filter((p) => p.id > 0 && p.name)
      .sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base', numeric: true }));
    populateFirstColumnDropdown(_projectsData);
  } catch (err) {
    console.error("Erreur chargement Projets2 pour dropdown:", err);
  }
}

// Fonction pour peupler la première liste déroulante avec des valeurs uniques de la première colonne
window.addEventListener('pageshow', () => {
  refreshProjectsDropdownFromProjets();
  scheduleReferenceRetardReconciliation();
});

window.addEventListener('focus', () => {
  const dropdown = document.getElementById('firstColumnDropdown');
  const savedProject = readSharedProjectSelection();
  if (!dropdown || dropdown.options.length <= 1 || (savedProject && !dropdown.value)) {
    refreshProjectsDropdownFromProjets();
  } else {
    refreshRestoredReferenceProject();
  }
  scheduleReferenceRetardReconciliation();
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    scheduleReferenceRetardReconciliation();
  }
});

function populateFirstColumnDropdown(values) {
  const dropdown = document.getElementById('firstColumnDropdown');
  if (!dropdown) return;

  // values peut être [{id, number, name}] ou string[]
  const projectObjects = (values || []).map((v) =>
    typeof v === 'object' && v !== null ? v : { id: null, number: '', name: String(v || '').trim() }
  ).filter((p) => p.name);

  const currentId = readSharedProjectId();
  const currentSelection = dropdown.value || readSharedProjectSelection();

  dropdown.innerHTML = '<option value="">Selectionner un projet</option>';

  projectObjects.forEach((p) => {
    const option = document.createElement('option');
    option.value = p.name;
    option.text = `${p.number} - ${p.name}`;
    if (p.id) option.dataset.projectId = String(p.id);
    dropdown.appendChild(option);
  });

  // Restaurer par ID d'abord, puis par nom
  let restoredProject = '';
  if (currentId) {
    const found = projectObjects.find((p) => p.id === currentId);
    if (found) restoredProject = found.name;
  }
  if (!restoredProject) {
    restoredProject = findSharedProjectMatch(projectObjects.map((p) => p.name), currentSelection);
  }

  dropdown.value = restoredProject;
  selectedFirstValue = dropdown.value || selectedFirstValue || '';
  if (restoredProject) {
    saveSharedProjectSelection(restoredProject);
    selectedFirstValue = restoredProject;
    refreshRestoredReferenceProject();
  }
}

function refreshRestoredReferenceProject() {
  if (!referenceRecordsReady) return false;

  const dropdown = document.getElementById('firstColumnDropdown');
  const project = String(dropdown?.value || selectedFirstValue || '').trim();
  const tableBody = document.getElementById('tableBody');
  const tableHeader = document.getElementById('tableHeader');

  if (!project) {
    selectedFirstValue = '';
    populateTypeDocumentDropdown('');
    resetZoneDropdown(true);
    if (tableBody) tableBody.innerHTML = '';
    if (tableHeader) tableHeader.innerHTML = '';
    return false;
  }

  selectedFirstValue = project;
  selectedTypeValue = selectedTypeValue || '';
  populateTypeDocumentDropdown(project, selectedTypeValue);
  populateZoneDropdown(project, selectedZoneValue);
  populateSecondColumnListbox(project, selectedSecondValue || lastValidDocument || '');
  updateEmetteurList();

  if (selectedSecondValue || lastValidDocument) {
    populateTable();
  } else {
    if (tableBody) tableBody.innerHTML = '';
    if (tableHeader) tableHeader.innerHTML = '';
  }
  return true;
}

// Réinitialise et désactive la seconde liste si aucun projet n'est sélectionné
document.getElementById('firstColumnDropdown').addEventListener('change', function () {
  const secondDropdown = document.getElementById('secondColumnListbox');
  const typeDropdown = document.getElementById('thirdColumnDropdown');
  const tableBody = document.getElementById('tableBody');
  const tableHeader = document.getElementById('tableHeader');

  selectedFirstValue = this.value.trim();
  selectedTypeValue = '';
  selectedSecondValue = '';
  lastValidDocument = '';
  selectedZoneValue = REFERENCE_ALL_ZONES_VALUE;

  if (!selectedFirstValue) {
    resetZoneDropdown(true);
    secondDropdown.disabled = true; // Désactiver la seconde liste
    secondDropdown.innerHTML = '<option value="">Sélectionner un étage</option>';
    tableBody.innerHTML = '';
    tableHeader.innerHTML = '';
    return;
  }

  secondDropdown.disabled = false; // Activer la seconde liste si un projet est sélectionné
  populateZoneDropdown(selectedFirstValue, REFERENCE_ALL_ZONES_VALUE);
  populateSecondColumnListbox(selectedFirstValue); // Actualiser la liste
  updateEmetteurList();
  secondDropdown.value = '';
  selectedSecondValue = '';
  tableBody.innerHTML = '';
  tableHeader.innerHTML = '';
});

// Function to populate the second dropdown based on the selected first column value
function populateSecondColumnListbox(selectedValue) {
  const listbox = document.getElementById('secondColumnListbox');
  listbox.innerHTML = '<option value="">Sélectionner un étage</option>'; // Réinitialise la liste

  const secondColumnValues = records
    .filter(record => record.NomProjet === selectedValue) // Filtre selon le projet
    .map(record => record.NomDocument) // Extrait les valeurs
    .filter((value, index, self) => value && self.indexOf(value) === index) // Supprime les doublons
    .sort();

  secondColumnValues.forEach(value => {
    const option = document.createElement('option');
    option.value = value;
    option.text = value;
    listbox.appendChild(option);
  });

  // Ajoute l'option "Ajouter document"
  const addOption = document.createElement('option');
  addOption.value = DOC_ADD_SPECIAL_VALUE;
  addOption.text = 'Ajouter documents';
  addOption.style.fontWeight = '700';
  listbox.appendChild(addOption);
}


// Helper function to check if a string is a valid date
function isValidDate(dateString) {
  const date = new Date(dateString);
  return date instanceof Date && !isNaN(date);
}

// Helper function to format date as DD/MM/YYYY
function formatDate(dateString) {
  const date = new Date(dateString);
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}

const REFERENCE_TABLE_HIDDEN_KEYS = new Set([
  'NomProjet',
  'NomDocument',
  'id',
  'NumeroDocument',
  'Type_document',
  'Zone',
]);

const REFERENCE_TABLE_PREFERRED_HEADER_ORDER = [
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
];

const REFERENCE_TABLE_HEADER_LABELS = {
  DureeLimite: 'Durée limite (sem.)',
  DateLimite: 'Date limite calculée',
};

function buildReferenceTableHeaders(filteredRecords) {
  const availableHeaders = [];
  const seenHeaders = new Set();

  (filteredRecords || []).forEach((record) => {
    Object.keys(record || {}).forEach((key) => {
      if (REFERENCE_TABLE_HIDDEN_KEYS.has(key) || seenHeaders.has(key)) {
        return;
      }
      seenHeaders.add(key);
      availableHeaders.push(key);
    });
  });

  const preferredHeaders = REFERENCE_TABLE_PREFERRED_HEADER_ORDER.filter((header) =>
    seenHeaders.has(header)
  );
  const remainingHeaders = availableHeaders.filter((header) =>
    !REFERENCE_TABLE_PREFERRED_HEADER_ORDER.includes(header)
  );

  return [...preferredHeaders, ...remainingHeaders];
}

function formatReferenceRetardValue(value) {
  if (value == null || value === '') return '';
  const numericValue = Number(value);
  return Number.isFinite(numericValue) && numericValue > 0
    ? String(Math.trunc(numericValue))
    : '';
}

function hasPositiveReferenceRetard(value) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) && numericValue > 0;
}

function removeColumnsFromClonedTableByHeaders(clonedTable, headerNames) {
  if (!(clonedTable instanceof HTMLTableElement)) return;

  const headersToRemove = new Set(headerNames || []);
  const indicesToRemove = Array.from(clonedTable.querySelectorAll('thead th'))
    .map((th, index) => headersToRemove.has(String(th.textContent || '').trim()) ? index : -1)
    .filter((index) => index >= 0)
    .sort((left, right) => right - left);

  clonedTable.querySelectorAll('tr').forEach(row => {
    indicesToRemove.forEach(idx => {
      if (row.children[idx]) {
        row.removeChild(row.children[idx]);
      }
    });
  });
}

// Add event listener for archive toggle checkbox
document.getElementById('hideArchivedToggle').addEventListener('change', () => {
  const second = document.getElementById('secondColumnListbox');
  const currentDoc = second.value;          // mémorise la sélection

  populateSecondColumnListbox(selectedFirstValue);

  second.value = currentDoc;                // restaure la sélection si elle existe encore
  populateTable();
});

// Function to populate the table based on the selected first and second column values
function populateTable() {
  const selections = getCurrentSelections();
  if (!selections) return;

  const { selectedProject, selectedTable, selectedDoc } = selections;
  const tableBody = document.getElementById('tableBody');
  const tableHeader = document.getElementById('tableHeader');
  const hideArchived = document.getElementById('hideArchivedToggle').checked;
  const selectedType = normalizeTypeDocument(selectedDoc?.type || getCurrentSelectedType());

  tableBody.innerHTML = '';
  const filteredRecords = records.filter(
    (record) => {
      if (
        normalizeReferenceDocumentIdentityPart(record.NomProjet) !==
        normalizeReferenceDocumentIdentityPart(selectedProject)
      ) return false;
      if (
        normalizeReferenceDocumentIdentityPart(record.NomDocument) !==
        normalizeReferenceDocumentIdentityPart(selectedTable)
      ) return false;
      if (
        normalizeReferenceDocumentIdentityPart(record.Type_document) !==
        normalizeReferenceDocumentIdentityPart(selectedType)
      ) return false;
      if (normalizeZoneMatchKey(record.Zone) !== normalizeZoneMatchKey(selectedDoc?.zone)) return false;

      if (selectedDoc && selectedDoc.numero != null) {
        const recordNumero = parseNumeroForStorage(record.NumeroDocument);
        if (
          normalizeReferenceDocumentIdentityPart(recordNumero) !==
          normalizeReferenceDocumentIdentityPart(selectedDoc.numero)
        ) return false;
      }

      return !hideArchived || !record.Archive;
    }
  );

  if (filteredRecords.length === 0) return;

  const headers = buildReferenceTableHeaders(filteredRecords);

  tableHeader.innerHTML = '<th>ID</th>';
  headers.forEach((header) => {
    const th = document.createElement('th');
    th.textContent = REFERENCE_TABLE_HEADER_LABELS[header] || header;
    tableHeader.appendChild(th);
  });
  // Add click handler for Bloquant column
  tableHeader.querySelector('th:nth-child(2)').addEventListener('click', (e) => {
    if (e.target.textContent === 'Bloquant') {
      // Toggle all Bloquant values
      const rows = tableBody.querySelectorAll('tr');
      rows.forEach(row => {
        const cell = row.querySelector('td:nth-child(2)');
        if (cell) {
          cell.click();
        }
      });
    }
  });

  filteredRecords.sort((a, b) => {
    const emetteurA = a.Emetteur || '';
    const emetteurB = b.Emetteur || '';
    return emetteurA.localeCompare(emetteurB);
  });

  filteredRecords.forEach((record) => {
    const tr = document.createElement('tr');
    tr.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      currentEmetteur = record.Emetteur;
      showContextMenu(event, record.id);

      // Retirer la surbrillance de toutes les lignes et de toutes les cellules émetteur
      document.querySelectorAll('#tableBody tr').forEach(row => {
        row.classList.remove('highlighted');
        if (row.cells[1]) {
          row.cells[1].classList.remove('highlighted');
        }
      });

      // Appliquer la surbrillance à la ligne cliquée pour les autres colonnes
      tr.classList.add('highlighted');

      // Pour la colonne "Emetteur" :
      // Si la cellule dans la ligne cliquée est masquée (fusionnée),
      // rechercher la cellule visible (dans la première ligne du groupe).
      let emitterCell = tr.cells[1];
      if (getComputedStyle(emitterCell).display === "none") {
        let currentRow = tr;
        // Parcourir les lignes précédentes jusqu'à trouver la cellule émetteur visible
        while (currentRow && getComputedStyle(currentRow.cells[1]).display === "none") {
          currentRow = currentRow.previousElementSibling;
        }
        if (currentRow && currentRow.cells[1]) {
          currentRow.cells[1].classList.add('highlighted');
        }
      } else {
        // Sinon, surligner directement la cellule de la ligne cliquée
        emitterCell.classList.add('highlighted');
      }
    });

    const idCell = document.createElement('td');
    idCell.textContent = record.id;
    tr.appendChild(idCell);

    headers.forEach((header, index) => {
      const td = document.createElement('td');
      td.contentEditable = false;
      let value = record[header];
      if (value == null) value = '';

      // Format date fields (Recu and DateLimite)
      if ((header === 'Recu' || header === 'DateLimite') && isValidDate(value)) {
        const formattedDate = formatDate(value);
        value = formattedDate === '01/01/1900' ? '-' : formattedDate;
      }
      if (header === 'DureeLimite') {
        value = formatReferenceDurationInput(value);
      }

      // Special handling for Bloquant and Archive columns
      if (header === 'Bloquant') {
        td.classList.add('bloquant-cell');
        td.textContent = Boolean(record.Bloquant) ? '\u2713' : '';
        td.style.cursor = 'pointer';
        td.title = "Cliquer pour cocher / décocher";
        td.addEventListener('click', async () => {
          const newValue = !Boolean(record.Bloquant);
          try {
            const planningTableForLimits = await fetchReferencePlanningTableForLimits();
            const referenceLimitFields = buildReferenceLimitFields({
              planningTable: planningTableForLimits,
              projectName: record.NomProjet || selectedFirstValue,
              documentInfo: {
                numero: record.NumeroDocument,
                name: record.NomDocument,
                type: record.Type_document,
                zone: record.Zone,
              },
              durationWeeks: record.DureeLimite,
              useZeroWhenEmpty: newValue,
              service: record.Service,
            });
            const updateFields = {
              Bloquant: newValue,
              ...referenceLimitFields,
              Retard: toReferenceRetardStorageValue(
                computeReferenceRetardDays(record.Recu, referenceLimitFields.DateLimite)
              ),
            };
            await grist.docApi.applyUserActions([
              ['UpdateRecord', 'References2', record.id, updateFields]
            ]);
            Object.assign(record, updateFields);
            populateTable();
          } catch (error) {
            console.error('Error updating Bloquant:', error);
            alert("Erreur lors de la mise à jour du bloquant.");
          }
        });
      } else if (header === 'Archive') {
        td.classList.add('archive-cell');
        td.textContent = value ? '✓' : '';
        td.style.cursor = 'pointer';
        td.title = "Cliquer pour archiver / désarchiver";

        td.addEventListener('click', async () => {
          // On se base sur la vraie valeur du record (pas sur la variable locale "value")
          const newValue = !Boolean(record.Archive);

          try {
            await grist.docApi.applyUserActions([
              ['UpdateRecord', 'References2', record.id, { Archive: newValue }]
            ]);

            // Mise à jour locale immédiate (UX)
            record.Archive = newValue;
            td.textContent = newValue ? '✓' : '';

            // Rafraîchit le tableau (utile pour le filtre "Masquer les archives")
            populateTable();

          } catch (error) {
            console.error('Error updating Archive:', error);
            alert("Erreur lors de la mise à jour de l'archive.");
          }
        });
      } else if (header === 'Retard') {
        const liveRetardValue = computeReferenceRetardDays(record?.Recu, record?.DateLimite);
        td.classList.add('retard-cell');
        td.classList.toggle('has-retard', hasPositiveReferenceRetard(liveRetardValue));
        td.textContent = formatReferenceRetardValue(liveRetardValue);
      } else {
        td.textContent = value;
      }
      tr.appendChild(td);
    });

    tableBody.appendChild(tr);
  });
  formatTable();
}

function formatTable() {
  const tableBody = document.getElementById('tableBody');
  const rows = tableBody.rows;
  let previousText = null;
  let rowspanCount = 1;

  for (let i = 0; i < rows.length; i++) {
    const currentCell = rows[i].cells[1]; // Second column

    if (currentCell.innerText === previousText) {
      // Increase rowspan count and hide current cell
      rows[i - rowspanCount].cells[1].rowSpan = rowspanCount + 1; // Update rowspan
      currentCell.style.display = "none"; // Hide current cell
      rowspanCount++;
    } else {
      // Reset rowspan count
      previousText = currentCell.innerText;
      rowspanCount = 1;
    }
  }
}

// Show edit dialog with row data
async function showEditDialog(record) {
  const dialog = document.getElementById('editRowDialog');

  if (!record) {
    console.warn("Aucun enregistrement sélectionné pour modification.");
    return;
  }
  console.log("Enregistrement en cours de modification :", record);

  getReferenceRowForm('edit')?.reset();
  clearReferenceFormErrors('edit');
  resetReferenceFilePicker('edit');
  referenceEditInitialSnapshot = '';
  updateReferenceDialogContext('edit', record);
  setReferenceFormBusy('edit', true, 'Chargement de la ligne…');

  // Assigne D'ABORD l'émetteur au champ "editEmetteur".
  document.getElementById('editEmetteur').value = record.Emetteur || '';

  // Met à jour la liste des références APRÈS avoir défini l'émetteur.
  updateEditReferenceList();

  // Maintenant on peut remplir la référence et les autres champs.
  document.getElementById('editReference').value = record.Reference || '';
  document.getElementById('editIndice').value = record.Indice || '';
  document.getElementById('editDescription').value = record.DescriptionObservations || '';
  document.getElementById('editRemarque').value = normalizeRemarqueValue(record.Remarque);
  document.getElementById('editRecu').value = formatReferenceDialogDate(record.Recu);
  const editDureeLimite = document.getElementById('editDureeLimite');
  editDureeLimite.value = formatReferenceDurationInput(record.DureeLimite);
  editDureeLimite.dataset.initialValue = editDureeLimite.value;

  dialog.showModal();
  document.getElementById('editEmetteur')?.focus();

  try {
    await Promise.all([
      updateEmetteurList(false, 'editEmetteurList'),
      updateEditEmetteurList(),
      fillEditDurationFromRecord(record),
    ]);
    setReferenceFormStatus('edit');
  } catch (error) {
    console.error('Erreur lors de la préparation du formulaire :', error);
    setReferenceFormStatus(
      'edit',
      'Certaines suggestions n’ont pas pu être chargées. Les valeurs de la ligne restent modifiables.',
      'error'
    );
  } finally {
    editDureeLimite.dataset.initialValue = editDureeLimite.value;
    referenceEditInitialSnapshot = getReferenceFormSnapshot('edit');
    setReferenceFormBusy('edit', false);
  }
}

// Gestion du menu contextuel et récupération de l'émetteur
function showContextMenu(event, recordId) {
  event.preventDefault();
  selectedRecordId = recordId; // Stocke l'ID de la ligne sélectionnée

  // Récupère l'émetteur de la ligne cliquée
  const matchingRecord = records.find(record => record.id === recordId);
  if (matchingRecord) {
    currentEmetteur = matchingRecord.Emetteur;

    const archiveBtn = document.getElementById('archiveOption');
    archiveBtn.textContent = matchingRecord.Archive ? 'Désarchiver' : 'Archiver';
  }

  const contextMenu = document.getElementById('contextMenu');
  contextMenu.style.display = 'block';
  contextMenu.style.left = `${event.pageX}px`;
  contextMenu.style.top = `${event.pageY}px`;
}

// Add event listener for "Ajouter une ligne" option
document.getElementById('addRowOption').addEventListener('click', async () => {
  const preparation = resetAndUpdateDialog();
  document.getElementById('addRowDialog').showModal();
  hideContextMenu();
  document.getElementById('emetteur')?.focus();
  try {
    await preparation;
  } catch (error) {
    console.error('Erreur lors de la préparation du formulaire :', error);
    setReferenceFormStatus(
      'add',
      'Certaines suggestions n’ont pas pu être chargées. Vous pouvez tout de même saisir les valeurs.',
      'error'
    );
  }
});

function updateEditReferenceList() {
  const selectedProject = document.getElementById('firstColumnDropdown').value;
  const selectedEmitter = document.getElementById('editEmetteur').value;
  const referenceList = document.getElementById('editReferenceList');

  if (!selectedProject || !selectedEmitter) {
    referenceList.innerHTML = '';
    return;
  }

  referenceList.innerHTML = '';

  // Ajouter la proposition "_"
  const defaultOption = document.createElement('option');
  defaultOption.value = '_';
  referenceList.appendChild(defaultOption);

  const filteredReferences = records
    .filter(record => record.NomProjet === selectedProject && record.Emetteur === selectedEmitter)
    .map(record => record.Reference)
    .filter((value, index, self) => value && self.indexOf(value) === index)
    .sort((a, b) => a.localeCompare(b, 'fr', { ignorePunctuation: true }));

  filteredReferences.forEach(reference => {
    const option = document.createElement('option');
    option.value = reference;
    referenceList.appendChild(option);
  });
}

function autoFillEditFields() {
  const selectedReference = document.getElementById('editReference').value;
  const selectedProject = document.getElementById('firstColumnDropdown').value;
  const selectedEmitter = document.getElementById('editEmetteur').value;

  if (!selectedReference || !selectedProject || !selectedEmitter) {
    return;
  }

  // Si "_" => valeurs par défaut
  if (selectedReference === '_') {
    document.getElementById('editIndice').value = '-';
    document.getElementById('editDescription').value = 'EN ATTENTE';
    document.getElementById('editRemarque').value = 'Officiel';
    document.getElementById('editRecu').value = '';
    const editDureeLimite = document.getElementById('editDureeLimite');
    editDureeLimite.value = '';
    editDureeLimite.dataset.initialValue = '';
    return;
  }

  // Sinon chercher le record correspondant
  const matchingRecord = records.find(record =>
    record.NomProjet === selectedProject &&
    record.Emetteur === selectedEmitter &&
    record.Reference === selectedReference
  );

  if (matchingRecord) {
    document.getElementById('editIndice').value = matchingRecord.Indice || '';
    document.getElementById('editDescription').value = matchingRecord.DescriptionObservations || '';
    document.getElementById('editRemarque').value = normalizeRemarqueValue(matchingRecord.Remarque);
    document.getElementById('editRecu').value = formatReferenceDialogDate(matchingRecord.Recu);
    const editDureeLimite = document.getElementById('editDureeLimite');
    editDureeLimite.value = formatReferenceDurationInput(matchingRecord.DureeLimite);
    editDureeLimite.dataset.initialValue = editDureeLimite.value;
    void fillEditDurationFromRecord(matchingRecord);
  } else {
    // Aucun matchingRecord -> vider ou laisser par défaut
    document.getElementById('editIndice').value = '';
    document.getElementById('editDescription').value = '';
    document.getElementById('editRemarque').value = '';
    document.getElementById('editRecu').value = '';
    const editDureeLimite = document.getElementById('editDureeLimite');
    editDureeLimite.value = '';
    editDureeLimite.dataset.initialValue = '';
  }
}

// Mise à jour de la liste des références lorsqu'on change le projet ou l'émetteur
document.getElementById('firstColumnDropdown').addEventListener('change', updateEditReferenceList);
document.getElementById('editEmetteur').addEventListener('change', updateEditReferenceList);

// Auto-remplissage des champs lors de la sélection ou de la saisie d'une référence
document.getElementById('editReference').addEventListener('change', autoFillEditFields);

document.getElementById('selectEditReferenceFileButton').addEventListener('click', () => {
  document.getElementById('editReferenceFile').click();
});
document.getElementById('editReferenceFile').addEventListener('change', () => {
  applyReferenceFileSelection('edit');
});
document.getElementById('clearEditReferenceFileButton').addEventListener('click', () => {
  resetReferenceFilePicker('edit');
  document.getElementById('editReference')?.focus();
});

getReferenceRowForm('edit')?.addEventListener('input', (event) => {
  clearReferenceFieldError(event.target);
  setReferenceFormStatus('edit');
  updateEditSubmitState();
});
getReferenceRowForm('edit')?.addEventListener('change', updateEditSubmitState);

// Add event listener for "Modifier" option
document.getElementById('editOption').addEventListener('click', () => {
  // Masquer le menu contextuel
  document.getElementById('contextMenu').style.display = 'none';

  if (selectedRecordId) {
    const record = records.find(rec => rec.id === selectedRecordId);
    if (record) {
      void showEditDialog(record);
    }
  }
});

// Handle dialog form submission
document.getElementById('addRowDialog').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (referenceFormBusyState.add || !validateReferenceRowForm('add')) return;

  const formData = new FormData(e.target);
  const emetteur = String(formData.get('emetteur') || '').trim();
  const reference = String(formData.get('reference') || '').trim();
  const indice = String(formData.get('indice') || '').trim();
  const recu = String(formData.get('recu') || '').trim() || DEFAULT_REFERENCE_DATE;
  const description = String(formData.get('description') || '').trim();
  const remarque = normalizeRemarqueValue(formData.get('remarque'));
  const dureeLimite = String(formData.get('dureeLimite') || '').trim();
  const isDuplicate = document.getElementById('duplicateCheckbox').checked;

  setReferenceFormBusy('add', true, 'Enregistrement en cours…');

  try {
    const selectedProject = selectedFirstValue;
    if (!selectedProject) throw new Error("Aucun projet sélectionné.");

    const serviceValue = await getTeamService();
    const planningTableForLimits = await fetchReferencePlanningTableForLimits();

    let selectedDocuments = [];
    if (isDuplicate) {
      syncDuplicateSelectedDocumentValues(document.getElementById('duplicateOptionsContainer'));
      selectedDocuments = Array.from(duplicateSelectedDocumentValues)
        .filter(isValidDuplicateDocumentValue);

      const secondDropdown = document.getElementById('secondColumnListbox');
      const currentVal = secondDropdown.value;
      if (isValidDuplicateDocumentValue(currentVal) && !selectedDocuments.includes(currentVal)) {
        selectedDocuments.push(currentVal);
      }

      if (selectedDocuments.length === 0) {
        setReferenceFormStatus('add', 'Sélectionnez au moins un document valide.', 'error');
        return;
      }
    } else {
      const currentDocument = getSelectedDocPair();
      if (currentDocument?.name) {
        selectedDocuments = [buildDocSelectValue(currentDocument)];
      }
    }

    if (selectedDocuments.length === 0) {
      throw new Error('Aucun document sélectionné.');
    }

    const userActions = [];
    const skippedDuplicates = [];
    selectedDocuments.forEach(docVal => {
      const parsedDoc = parseDocValue(docVal);
      const documentType = getDocumentTypeForProjectDoc(
        selectedProject,
        parsedDoc.name,
        parsedDoc.zone,
        parsedDoc.numero,
        parsedDoc.type
      ) || normalizeTypeDocument(parsedDoc.type || getCurrentSelectedType());
      const documentInfo = {
        ...parsedDoc,
        type: documentType,
      };
      const newRow = sanitizeReferences2DialogFields(withComputedReferenceRetard({
        NomProjet: selectedProject,
        NomDocument: parsedDoc.name,
        NumeroDocument: _norm(parsedDoc.numero),
        Type_document: documentType,
        Zone: normalizeZoneValue(parsedDoc.zone),
        Emetteur: emetteur,
        Reference: reference,
        Indice: indice,
        Recu: recu,
        DescriptionObservations: description,
        Remarque: remarque,
        ...buildReferenceLimitFields({
          planningTable: planningTableForLimits,
          projectName: selectedProject,
          documentInfo,
          durationWeeks: dureeLimite,
          service: serviceValue,
        }),
        Service: serviceValue
      }));

      if (findReferenceDialogDuplicate(newRow)) {
        skippedDuplicates.push(makeDocLabel(parsedDoc.name, parsedDoc.numero));
        return;
      }
      userActions.push(['AddRecord', 'References2', null, newRow]);
    });

    if (userActions.length === 0) {
      setReferenceFormStatus(
        'add',
        skippedDuplicates.length > 1
          ? `Ces ${skippedDuplicates.length} références existent déjà. Aucune ligne ajoutée.`
          : 'Cette référence existe déjà sur le document. Aucune ligne ajoutée.',
        'error'
      );
      return;
    }

    // Un seul appel conserve l'ajout multiple dans une transaction Grist unique.
    await grist.docApi.applyUserActions(userActions);
    console.log("Ligne(s) ajoutée(s) avec succès.");

    resetDuplicateSelectedDocumentValues();
    document.getElementById('addRowDialog').close();
    await populateTable();
    const addedCount = userActions.length;
    showReferenceToast(
      `${addedCount} référence${addedCount > 1 ? 's ajoutées' : ' ajoutée'}.` +
      (skippedDuplicates.length
        ? ` ${skippedDuplicates.length} doublon${skippedDuplicates.length > 1 ? 's ignorés' : ' ignoré'}.`
        : ''),
      { warning: skippedDuplicates.length > 0 }
    );
  } catch (error) {
    console.error("Erreur lors de l'ajout des lignes :", error?.message || error, error);
    setReferenceFormStatus(
      'add',
      `Impossible d'ajouter la référence${error?.message ? ` : ${error.message}` : '.'}`,
      'error'
    );
  } finally {
    setReferenceFormBusy('add', false);
  }
});

// Gérer l'annulation du formulaire d'ajout de ligne
document.getElementById('cancelAddRowButton').addEventListener('click', () => {
  resetDuplicateSelectedDocumentValues();
  document.getElementById('addRowDialog').close();
});

document.getElementById('cancelEditRowButton').addEventListener('click', () => {
  document.getElementById('editRowDialog').close();
});

['add', 'edit'].forEach(mode => {
  const dialog = document.getElementById(getReferenceRowFormConfig(mode).dialogId);
  dialog?.addEventListener('cancel', event => {
    if (referenceFormBusyState[mode]) event.preventDefault();
  });
});

// Add event listener for "Archiver" option
document.getElementById('archiveOption').addEventListener('click', async () => {
  if (!selectedRecordId) return;

  const record = records.find(r => r.id === selectedRecordId);
  const currentValue = Boolean(record?.Archive);
  const newValue = !currentValue;

  const verb = newValue ? "archiver" : "désarchiver";
  const ok = confirm(`Êtes-vous sûr de vouloir ${verb} cette ligne ?`);
  if (!ok) return;

  try {
    await grist.docApi.applyUserActions([
      ['UpdateRecord', 'References2', selectedRecordId, { Archive: newValue }]
    ]);

    if (record) record.Archive = newValue;

    populateTable();    // important pour appliquer "Masquer les archives"
    hideContextMenu();
  } catch (error) {
    console.error(`Error while trying to ${verb}:`, error);
    alert("Erreur lors de la mise à jour de l'archive.");
  }
});

document.getElementById('deleteOption').addEventListener('click', async () => {
  if (!selectedRecordId) {
    console.warn("Aucune ligne sélectionnée pour suppression.");
    return;
  }

  // Demande de confirmation
  const confirmDelete = confirm("Êtes-vous sûr de vouloir supprimer cette ligne ?");
  if (!confirmDelete) {
    console.log("Suppression annulée par l'utilisateur.");
    return;
  }

  // Demander un mot de passe avant de supprimer
  const password = prompt("Veuillez entrer le mot de passe pour supprimer cette ligne :");

  const correctPassword = "admin";

  if (password !== correctPassword) {
    alert("Mot de passe incorrect. Suppression annulée.");
    console.warn("Tentative de suppression avec un mot de passe incorrect.");
    return;
  }

  // Suppression après validation du mot de passe
  try {
    await grist.docApi.applyUserActions([
      ['RemoveRecord', 'References2', selectedRecordId]
    ]);

    console.log(`Ligne ${selectedRecordId} supprimée avec succès.`);
    populateTable(); // Rafraîchir la table
    hideContextMenu();
  } catch (error) {
    console.error("Erreur lors de la suppression de la ligne :", error);
    alert("Une erreur s'est produite lors de la suppression.");
  }
});

// Fonction pour cacher le menu contextuel
function hideContextMenu() {
  const contextMenu = document.getElementById('contextMenu');
  contextMenu.style.display = 'none';

  // Supprime la surbrillance de toutes les lignes et de toutes les cellules (colonnes)
  document.querySelectorAll('#tableBody tr.highlighted, #tableBody td.highlighted').forEach(el => {
    el.classList.remove('highlighted');
  });
}

// Fetch records from Grist
grist.onRecords(function (receivedRecords, tableId) {
  if (tableId === 'Team') return;

  records = receivedRecords;
  referenceRecordsReady = true;
  buildReferencesNumeroCache(receivedRecords);
  scheduleReferenceRetardReconciliation();

  if (newTable) {
    newTable = false; // Reset the flag after handling the new table
    const preferredType = normalizeTypeDocument(newTableType || selectedTypeValue);
    const parsedNewDoc = parseDocValue(newTableName);
    const preferredZone = normalizeZoneValue(parsedNewDoc.zone) || REFERENCE_NO_ZONE_VALUE;
    populateTypeDocumentDropdown(selectedFirstValue, preferredType, preferredType ? [preferredType] : []);
    populateZoneDropdown(selectedFirstValue, preferredZone);
    populateSecondColumnListbox(selectedFirstValue, newTableName);
    updateEmetteurList(); // Met à jour la liste des émetteurs en fonction du projet sélectionné

    // Sélectionne automatiquement le nouveau tableau
    const listbox = document.getElementById('secondColumnListbox');
    listbox.value = newTableName;

    // Déclenche l'affichage du tableau correspondant
    selectedSecondValue = newTableName;
    lastValidDocument = newTableName;
    selectedDocName = parsedNewDoc.name || '';
    selectedDocNumber = parseNumeroForStorage(parsedNewDoc.numero);
    selectedDocZone = normalizeZoneValue(parsedNewDoc.zone);
    newTableType = '';
    populateTable();
  } else {
    populateTable()
    // Populate the first dropdown with unique values from 'NomProjet'
    refreshProjectsDropdownFromProjets();
  }
});

document.getElementById('secondColumnListbox').addEventListener('change', function () {
  const selectedValue = this.value;
  console.log("Tableau sélectionné :", selectedValue);
  if (isSpecialDocumentOptionValue(selectedValue)) {
    this.value = lastValidDocument || '';
    selectedSecondValue = lastValidDocument || '';
    openUnifiedAddDocumentsDialog();
    return;
  }
  // Enregistrez la sélection valide si elle n'est pas vide
  if (selectedValue.trim() !== "") {
    lastValidDocument = selectedValue;
  }
  selectedSecondValue = selectedValue;
  if (selectedValue && !isSpecialDocumentOptionValue(selectedValue)) {
    const parsedDoc = parseDocValue(selectedValue);
    selectedDocName = parsedDoc.name || '';
    selectedDocNumber = parseNumeroForStorage(parsedDoc.numero);
    selectedDocZone = normalizeZoneValue(parsedDoc.zone);
  } else {
    selectedDocName = '';
    selectedDocNumber = null;
    selectedDocZone = '';
  }
  console.log("selectedFirstValue:", selectedFirstValue, "selectedSecondValue:", selectedSecondValue);
  if (selectedFirstValue && selectedSecondValue) {
    populateTable();
    scheduleReferenceRetardReconciliation();
  }
});

// Fonction pour gérer l'ajout d'un tableau
function handleAddTable() {
  openUnifiedAddDocumentsDialog();
}

// Fermer la liste déroulante si on clique en dehors
document.addEventListener('click', (event) => {
  const dropdown = document.getElementById('emetteurDropdown');
  const button = document.getElementById('emetteurDropdownButton');
  if (dropdown && button && !dropdown.contains(event.target) && !button.contains(event.target)) {
    dropdown.style.display = 'none';
  }
});

document.getElementById('addDocumentDialog').addEventListener('submit', async (e) => {
  e.preventDefault();
  let previousSelectionState = null;

  trimInputs(e.target); // Nettoie les entrées (évite les espaces superflus)

  const formData = new FormData(e.target);
  const documentNumber = formData.get('documentNumber');
  const documentName = formData.get('documentName');
  const documentZone = resolveReferenceDocumentZone(formData.get('documentZone'), selectedFirstValue);
  const documentType = normalizeTypeDocument(formData.get('documentType'));
  const defaultDureeLimite = formData.get('defaultDureeLimite');

  if (String(defaultDureeLimite ?? '').trim() && parseReferenceDurationLimit(defaultDureeLimite) == null) {
    alert("La duree limite par defaut doit etre un nombre entier de semaines.");
    return;
  }

  const combinedDocumentName = `${documentNumber}-${documentName}`.trim();

  if (!documentType) {
    alert("Veuillez renseigner un type de document.");
    return;
  }

  if (!documentNumber || !documentName.trim()) {
    alert("Le numéro et le nom du document sont requis.");
    return;
  }

  let serviceValue = '';
  try {
    serviceValue = await getTeamService();
    await assertReferenceDocumentIdentitiesAvailable(selectedFirstValue, [{
      number: documentNumber,
      name: documentName,
      type: documentType,
    }], serviceValue);
  } catch (error) {
    alert(error.message);
    return;
  }

  const selectedEmitters = Array.from(
    document.querySelectorAll('#emetteurDropdown input[type="checkbox"]:checked')
  ).filter(checkbox => {
    const checkboxId = String(checkbox?.id || '');
    return checkbox?.dataset?.selectAll !== 'true' &&
      checkboxId !== 'selectAllEmitters' &&
      !checkboxId.endsWith('_selectAll');
  }).map(checkbox => {
    // Trouve l'input texte qui est juste après la case à cocher
    const textInput = checkbox.nextElementSibling;

    // Si c'est un champ texte (pour les émetteurs personnalisés)
    if (textInput && textInput.tagName === "INPUT" && textInput.type === "text") {
      const customValue = textInput.value.trim();
      return customValue ? customValue : null; // Retourne la valeur écrite, sinon null
    }

    return checkbox.value; // Pour les émetteurs standards
  }).filter(value => value); // Supprime les valeurs nulles

  if (selectedEmitters.length === 0) {
    alert("Veuillez sélectionner au moins un émetteur.");
    return;
  }

  const selectedProject = selectedFirstValue;
  if (!selectedProject) {
    alert("Veuillez sélectionner un projet avant d'ajouter un document.");
    return;
  }

  try {
    // Récupérer l'ID du projet
    const selectedProject = selectedFirstValue;
    if (!selectedProject) throw new Error("Aucun projet sélectionné.");


    // Création des nouvelles lignes
    const num = _norm(documentNumber);
    const nm = String(documentName).trim();
    const planningTableForLimits = await fetchReferencePlanningTableForLimits();
    const referenceLimitFields = buildReferenceLimitFields({
      planningTable: planningTableForLimits,
      projectName: selectedProject,
      documentInfo: {
        documentNumber: num,
        documentName: nm,
        documentType,
        documentZone,
      },
      durationWeeks: defaultDureeLimite,
      service: serviceValue,
    });
    const newRows = selectedEmitters.map((emetteur) => withComputedReferenceRetard({
      NomProjet: selectedProject,
      NomDocument: nm,
      NumeroDocument: num,
      Type_document: documentType,
      Zone: documentZone,
      Emetteur: emetteur,
      Reference: '_',
      Indice: '-',
      Recu: '1900-01-01',
      DescriptionObservations: 'EN ATTENTE',
      ...referenceLimitFields,
      Service: serviceValue
    }));

    // 1) Upsert dans la table ListePlan (une seule fois par document, pas par émetteur)
    let planAction = null;
    try {
      const plansTableName = await resolveListePlanTableName();
      const plans = await grist.docApi.fetchTable(plansTableName);

      const numStrPlan = _norm(documentNumber);
      const idxPlan = findListePlanIndex(
        plans,
        selectedProject,
        numStrPlan,
        documentType,
        documentZone,
        nm,
        serviceValue
      );

      if (idxPlan >= 0) {
        planAction = ['UpdateRecord', plansTableName, plans.id[idxPlan], {
          Type_document: documentType,
          Zone: documentZone,
          Designation: nm,
        }];
      } else {
        planAction = ['AddRecord', plansTableName, null, {
          Nom_projet: selectedProject,
          NumeroDocument: numStrPlan,
          Type_document: documentType,
          Zone: documentZone,
          Designation: nm,
          Service: serviceValue
        }];
      }
    } catch (err) {
      throw new Error(`ListePlan: impossible de preparer le document. ${err.message || err}`);
    }

    // 1b) Upsert dans Planning_Projet / Planning_Project
    const planningActions = [];
    try {
      const planningTableName = await resolvePlanningTableName();
      const planning = await grist.docApi.fetchTable(planningTableName);
      const planningZoneAnchorAction = buildPlanningZoneAnchorActionIfMissing(
        planningTableName,
        planning,
        selectedProject,
        documentZone,
        serviceValue
      );
      if (planningZoneAnchorAction) {
        planningActions.push(planningZoneAnchorAction);
      }

      const numStrPlanning = _norm(documentNumber);
      const idxPlanning = findPlanningIndex(
        planning,
        selectedProject,
        numStrPlanning,
        documentType,
        documentZone,
        nm,
        serviceValue
      );
      if (idxPlanning >= 0) {
        planningActions.push([
          'UpdateRecord',
          planningTableName,
          planning.id[idxPlanning],
          buildPlanningDocumentUpdateFields(planning, {
            taskName: nm,
            typeDoc: documentType,
            zoneStr: documentZone
          })
        ]);
      } else {
        planningActions.push([
          'AddRecord',
          planningTableName,
          null,
          buildPlanningDocumentAddFields(planning, {
            projectName: selectedProject,
            numeroDocStr: numStrPlanning,
            taskName: nm,
            typeDoc: documentType,
            zoneStr: documentZone,
            service: serviceValue
          })
        ]);
      }
    } catch (err) {
      throw new Error(`Planning: impossible de preparer le document. ${err.message || err}`);
    }

    // 2) Ajout des lignes dans References
    const actions = [];
    if (planAction) actions.push(planAction);
    planningActions.forEach((action) => actions.push(action));
    newRows.forEach(row => actions.push(['AddRecord', 'References2', null, row]));
    const typeDocActions = await buildProjectTypeDocUpdateActions(selectedProject, [documentType]);
    typeDocActions.forEach((action) => actions.unshift(action));
    previousSelectionState = captureDocumentSelectionState();
    queueNewDocumentSelection({
      numero: num,
      name: nm,
      zone: documentZone,
      type: documentType,
    });
    await applyUserActionsInChunks(actions);
    await refreshReferenceTypeSuggestionLists(selectedProject);
    selectedTypeValue = '';
    restoreLastDocumentSelection();

    console.log("Nouveau document ajouté :", combinedDocumentName);

    // Fermeture du dialogue
    document.getElementById('addDocumentDialog').close();

  } catch (error) {
    restoreDocumentSelectionState(previousSelectionState || {});
    console.error("Erreur lors de l'ajout du document :", error);
    alert("Une erreur s'est produite lors de l'ajout du document.");
  }
});

// Fonction pour convertir une date en "DD/MM/YYYY"
function formatDate(dateString) {
  const date = new Date(dateString);
  if (isNaN(date.getTime())) {
    return ''; // Retourne une chaîne vide si la date est invalide
  }
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0'); // Les mois sont indexés de 0 à 11
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}

function getCurrentSelections(isAddTableAction = false) {
  const projectDropdown = document.getElementById('firstColumnDropdown');
  const tableDropdown = document.getElementById('secondColumnListbox');

  const selectedProject = projectDropdown.value.trim();
  const selectedValue = tableDropdown.value.trim();
  const selectedDoc = parseDocValue(selectedValue);
  const selectedTable = _norm(selectedDoc.name || selectedValue);

  if (!selectedProject || !selectedValue || !selectedTable) {
    return null; // Retourne null si les sélections sont invalides
  }

  return { selectedProject, selectedTable, selectedDoc, selectedValue };
}

// Fonction de sauvegarde mise à jour
async function saveChanges() {
  // Obtenez les sélections actuelles
  const selections = getCurrentSelections();
  if (!selections) return; // Interrompt la fonction si les sélections sont invalides

  const { selectedProject, selectedTable } = selections;

  console.log(`Sauvegarde en cours pour le tableau "${selectedTable}" du projet "${selectedProject}".`);

  // Récupère les lignes du tableau HTML
  const tableBody = document.getElementById('tableBody');
  const rows = tableBody.getElementsByTagName('tr');

  const columnMap = ['Emetteur', 'Reference', 'Indice', 'Recu', 'DescriptionObservations'];
  const updates = [];

  for (const row of rows) {
    const cells = row.getElementsByTagName('td');
    const rowId = cells[0].textContent.trim(); // ID_Ligne

    // Recherche la ligne correspondante dans `records`
    const record = records.find(
      (rec) =>
        rec.ID_Ligne === rowId &&
        rec.NomProjet === selectedProject &&
        rec.NomDocument === selectedTable
    );

    if (!record) {
      console.warn(`Ligne introuvable pour ID_Ligne = ${rowId}, Projet = ${selectedProject}, Tableau = ${selectedTable}`);
      continue;
    }

    const updatedFields = {};
    let hasChanges = false;

    // Compare chaque champ
    for (let i = 1; i < cells.length; i++) {
      const fieldName = columnMap[i - 1];
      const cellValue = cells[i].textContent.trim();

      if (record[fieldName] !== cellValue) {
        updatedFields[fieldName] = cellValue;
        hasChanges = true;
      }
    }

    if (hasChanges) {
      updates.push(['UpdateRecord', 'Fusion', Number(rowId), updatedFields]);
    }
  }

  if (updates.length > 0) {
    try {
      await grist.docApi.applyUserActions(updates);
      console.log("Modifications sauvegardées avec succès :", updates);
      alert("Les modifications ont été sauvegardées.");
    } catch (error) {
      console.error("Erreur lors de la sauvegarde :", error);
      alert("Erreur lors de la sauvegarde.");
    }
  } else {
    alert("Aucune modification détectée pour la sauvegarde.");
  }
}

// Fonction pour ajouter une nouvelle ligne dans Grist avec le nom de fichier dans "Reference"
function addRowWithFileName(fileName, chemin) {
  if (!selectedFirstValue || !selectedSecondValue) {
    alert("Veuillez sélectionner un projet et un tableau.");
    return;
  }

  // Enlève l'extension du fichier (partie après le dernier point)
  const fileNameWithoutExtension = fileName.split('.').slice(0, -1).join('.');

  // Trouve la valeur la plus élevée d'ID_Ligne dans records
  const maxIdLigne = records.reduce((max, record) => {
    const idLigne = parseInt(record.ID_Ligne, 10);
    return idLigne > max ? idLigne : max;
  }, 0);

  // Définit une nouvelle valeur pour ID_Ligne en l'incrémentant de 1
  const newIdLigne = maxIdLigne + 1;

  // Création de la nouvelle ligne avec la valeur de ID_Ligne et le nom du fichier sans extension pour "Reference"
  const newRow = {
    NomProjet: selectedFirstValue,
    NomDocument: getSelectedDocPair().name,
    NumeroDocument: _norm(getSelectedDocPair().numero),
    Emetteur: '',
    Reference: fileNameWithoutExtension, // Nom du fichier sans extension
    Indice: '',
    Recu: '',
    DescriptionObservations: '',
    Chemin: (chemin || null),
    ID_Ligne: newIdLigne.toString() // Convertit en string pour s'aligner avec les autres valeurs
  };

  // Envoie la requête pour ajouter la nouvelle ligne dans Grist
  grist.docApi.applyUserActions([
    ['AddRecord', 'Fusion', null, newRow]
  ])
    .then(() => {
      console.log("Nouvelle ligne ajoutée avec le fichier :", newRow);
      // Actualise les données pour inclure la nouvelle ligne ajoutée
      records.push(newRow); // Mise à jour locale
      populateTable(); // Actualise l'affichage du tableau HTML
    })
    .catch(error => {
      console.error("Erreur lors de l'ajout de la ligne avec le fichier :", error);
      alert("Erreur lors de l'ajout de la ligne.");
    });
}

// Gère l'événement de sélection de fichiers
document.getElementById('fileInput').addEventListener('change', (event) => {
  const files = event.target.files;
  if (files.length > 0) {
    Array.from(files).forEach(file => {
      addRowWithFileName(file.name); // Ajoute une ligne pour chaque fichier sélectionné
    });
  }
});

const addProjectBtn = document.getElementById('addProjectButton');
if (addProjectBtn) {
  addProjectBtn.addEventListener('click', () => {
    document.getElementById('addProjectDialog').showModal();
  });
}

// Fonction pour supprimer les espaces en début et fin de chaque champ input
function trimInputs(form) {
  const inputs = form.querySelectorAll("input[type='text'], input[type='number']");
  inputs.forEach(input => input.value = input.value.trim());
}

// Gère l'ajout d'un projet
document.getElementById('addProjectDialog').addEventListener('submit', async (e) => {
  e.preventDefault();

  trimInputs(e.target); // Nettoyage des champs avant soumission

  const formData = new FormData(e.target);
  const projectNumber = formData.get('projectNumber');
  const projectName = formData.get('projectName');

  if (!projectNumber || !projectName.trim()) {
    alert("Le numéro et le nom du projet sont requis.");
    return;
  }

  try {
    const result = await grist.docApi.applyUserActions([
      ['AddRecord', 'Projets2', null, { 'Numero_de_projet': projectNumber, 'Nom_de_projet': projectName }]
    ]);

    const newProjectId = result.retValues[0];

    const dropdown = document.getElementById('firstColumnDropdown');
    const option = document.createElement('option');
    option.value = projectName;
    option.text = projectName;
    dropdown.appendChild(option);

    dropdown.value = projectName;
    selectedFirstValue = projectName;

    // === Réinitialisation de la liste des documents et du tableau ===
    const secondDropdown = document.getElementById('secondColumnListbox');
    const tableBody = document.getElementById('tableBody');
    const tableHeader = document.getElementById('tableHeader');

    secondDropdown.innerHTML = '<option value="">Sélectionner un étage</option>';
    selectedSecondValue = ''; // Réinitialiser la sélection du document
    tableBody.innerHTML = ''; // Effacer le contenu du tableau
    tableHeader.innerHTML = ''; // Effacer l'en-tête du tableau

    // Mettre à jour la liste des documents pour le projet sélectionné (sans la désactiver)
    populateSecondColumnListbox(projectName);

    document.getElementById('addProjectDialog').close();

  } catch (error) {
    console.error("Erreur lors de l'ajout du projet :", error);
    alert("Une erreur s'est produite lors de l'ajout du projet.");
  }
});

let duplicateSelectedDocumentValues = new Set();

function syncDuplicateSelectedDocumentValues(container) {
  if (!container) return;
  container.querySelectorAll("input[name='documents']").forEach(input => {
    if (input.checked) {
      duplicateSelectedDocumentValues.add(input.value);
    } else {
      duplicateSelectedDocumentValues.delete(input.value);
    }
  });
}

function resetDuplicateSelectedDocumentValues() {
  duplicateSelectedDocumentValues = new Set();
}

function isValidDuplicateDocumentValue(value) {
  if (!value || isSpecialDocumentOptionValue(value)) return false;
  const parsed = parseDocValue(value);
  return Boolean(normalizeReferenceDocumentIdentityPart(parsed.name));
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function isCurrentDuplicateDocumentEntry(entry, selectedDocumentValue) {
  if (!entry || !selectedDocumentValue) return false;
  if (entry.value === selectedDocumentValue) return true;

  const parsedSelected = parseDocValue(selectedDocumentValue);
  const selectedName = normalizeReferenceDocumentIdentityPart(parsedSelected.name);
  const entryName = normalizeReferenceDocumentIdentityPart(entry.name);
  if (!selectedName || !entryName || selectedName !== entryName) return false;

  const selectedType = normalizeReferenceDocumentIdentityPart(parsedSelected.type || getCurrentSelectedType());
  const entryType = normalizeReferenceDocumentIdentityPart(entry.type);
  if (selectedType && entryType && selectedType !== entryType) return false;

  if (normalizeZoneMatchKey(parsedSelected.zone) !== normalizeZoneMatchKey(entry.zone)) return false;

  const selectedNumero = parseNumeroForStorage(parsedSelected.numero);
  const entryNumero = parseNumeroForStorage(entry.numero);
  return normalizeReferenceDocumentIdentityPart(selectedNumero) ===
    normalizeReferenceDocumentIdentityPart(entryNumero);
}

function buildDuplicateDocumentCheckboxMarkup(option, index, preservedCheckedValues) {
  const searchText = [option.label, option.type, option.zone, option.numero]
    .map(value => String(value ?? '').toLocaleLowerCase('fr'))
    .join(' ');
  return `
        <div class="emetteur-item duplicate-document-item" data-duplicate-search="${escapeHtml(searchText)}">
          <input type="checkbox" id="doc-${index}" name="documents" value="${escapeHtml(option.value)}"${preservedCheckedValues.has(option.value) ? ' checked' : ''}>
          <label for="doc-${index}">${escapeHtml(option.label)}</label>
        </div>
      `;
}

function buildGroupedDuplicateDocumentList(documentOptions, showZoneSections, preservedCheckedValues) {
  let checkboxIndex = 0;
  const groupedTypes = new Map();

  documentOptions.forEach((option) => {
    const typeKey = normalizeReferenceDocumentIdentityPart(option.type) || '__sans_type__';
    if (!groupedTypes.has(typeKey)) {
      groupedTypes.set(typeKey, {
        type: normalizeTypeDocument(option.type),
        zones: new Map(),
      });
    }

    const zoneKey = normalizeZoneMatchKey(option.zone) || '__sans_zone__';
    const typeGroup = groupedTypes.get(typeKey);
    if (!typeGroup.zones.has(zoneKey)) {
      typeGroup.zones.set(zoneKey, {
        zone: normalizeZoneValue(option.zone),
        entries: [],
      });
    }
    typeGroup.zones.get(zoneKey).entries.push(option);
  });

  return Array.from(groupedTypes.values()).map((typeGroup) => {
    const zoneGroups = Array.from(typeGroup.zones.values())
      .sort((left, right) => compareZoneKeys(left.zone, right.zone));
    const zonesHTML = zoneGroups.map((zoneGroup) => {
      const entriesHTML = zoneGroup.entries.map((option) =>
        buildDuplicateDocumentCheckboxMarkup(option, checkboxIndex++, preservedCheckedValues)
      ).join('');

      return `
        <div class="duplicate-zone-group">
          ${showZoneSections ? `<div class="duplicate-zone-heading">${escapeHtml(formatZoneLabel(zoneGroup.zone))}</div>` : ''}
          ${entriesHTML}
        </div>
      `;
    }).join('');

    return `
      <div class="duplicate-document-group">
        <div class="duplicate-type-heading">${escapeHtml(typeGroup.type || 'Sans type')}</div>
        ${zonesHTML}
      </div>
    `;
  }).join('');
}

function getVisibleDuplicateDocumentCheckboxes() {
  const container = document.getElementById('duplicateOptionsContainer');
  if (!container) return [];
  return Array.from(container.querySelectorAll("input[name='documents']"))
    .filter(input => !input.closest('.duplicate-document-item')?.hidden);
}

function filterDuplicateDocumentList(query = '') {
  const container = document.getElementById('duplicateOptionsContainer');
  if (!container) return;
  const normalizedQuery = String(query || '').trim().toLocaleLowerCase('fr');
  const items = Array.from(container.querySelectorAll('.duplicate-document-item'));
  items.forEach(item => {
    item.hidden = Boolean(normalizedQuery) &&
      !String(item.dataset.duplicateSearch || '').includes(normalizedQuery);
  });

  container.querySelectorAll('.duplicate-zone-group').forEach(group => {
    group.hidden = !Array.from(group.querySelectorAll('.duplicate-document-item'))
      .some(item => !item.hidden);
  });
  container.querySelectorAll('.duplicate-document-group').forEach(group => {
    group.hidden = !Array.from(group.querySelectorAll('.duplicate-document-item'))
      .some(item => !item.hidden);
  });

  const empty = document.getElementById('duplicateSearchEmpty');
  if (empty) empty.hidden = items.length === 0 || items.some(item => !item.hidden);
}

function getAddDialogTargetDocumentValues() {
  const values = new Set();
  const currentValue = document.getElementById('secondColumnListbox')?.value;
  if (isValidDuplicateDocumentValue(currentValue)) values.add(currentValue);
  if (document.getElementById('duplicateCheckbox')?.checked) {
    duplicateSelectedDocumentValues.forEach(value => {
      if (isValidDuplicateDocumentValue(value)) values.add(value);
    });
  }
  if (values.size === 0) {
    const currentDocument = getSelectedDocPair();
    if (currentDocument?.name) values.add(buildDocSelectValue(currentDocument));
  }
  return Array.from(values);
}

function updateDuplicateSelectionSummary() {
  const values = getAddDialogTargetDocumentValues();
  const total = Math.max(1, values.length);
  const summary = document.getElementById('duplicateSelectionSummary');
  const submit = document.getElementById('confirmAddRowButton');
  const count = document.getElementById('duplicateSelectionCount');
  const emitter = String(document.getElementById('emetteur')?.value || '').trim();
  const reference = String(document.getElementById('referenceInput')?.value || '').trim();
  const indice = String(document.getElementById('indice')?.value || '').trim();
  let duplicateCount = 0;

  if (emitter && reference && indice) {
    values.forEach(value => {
      const documentInfo = parseDocValue(value);
      const candidate = {
        NomProjet: selectedFirstValue,
        NomDocument: documentInfo.name,
        NumeroDocument: documentInfo.numero,
        Type_document: documentInfo.type || getCurrentSelectedType(),
        Zone: documentInfo.zone,
        Emetteur: emitter,
        Reference: reference,
        Indice: indice,
      };
      if (findReferenceDialogDuplicate(candidate)) duplicateCount += 1;
    });
  }

  if (summary) {
    const duplicateMessage = emitter && reference && indice
      ? (duplicateCount
          ? ` ${duplicateCount} doublon${duplicateCount > 1 ? 's seront ignorés' : ' sera ignoré'}.`
          : ' Aucun doublon détecté.')
      : ' Complétez l’émetteur, la référence et l’indice pour vérifier les doublons.';
    summary.textContent = `${total} document${total > 1 ? 's concernés' : ' concerné'}.${duplicateMessage}`;
  }
  if (count) {
    count.textContent = `${duplicateSelectedDocumentValues.size} autre${duplicateSelectedDocumentValues.size > 1 ? 's' : ''} sélectionné${duplicateSelectedDocumentValues.size > 1 ? 's' : ''}`;
  }
  if (submit && !referenceFormBusyState.add) {
    submit.textContent = total > 1 ? `Ajouter sur ${total} documents` : 'Ajouter';
  }
}

function refreshDuplicateSelectionUi() {
  const visible = getVisibleDuplicateDocumentCheckboxes();
  const selectVisibleButton = document.getElementById('selectVisibleDocuments');
  if (selectVisibleButton) {
    selectVisibleButton.disabled = visible.length === 0 || visible.every(input => input.checked);
  }
  updateDuplicateSelectionSummary();
}

async function renderDocumentCheckboxList(typeFilterValue = null, checkedValues = null) {
  const container = document.getElementById('duplicateOptionsContainer');
  const secondDropdown = document.getElementById('secondColumnListbox');
  const selectedProject = selectedFirstValue; // Projet sélectionné dans la première liste
  const selectedDocument = secondDropdown.value; // Document actuellement sélectionné dans la deuxième liste
  const showZones = projectHasStructuredZones(selectedProject);
  const currentFilterElement = document.getElementById('duplicateTypeDocumentFilter');
  const selectedTypeFilter = normalizeTypeDocument(
    typeFilterValue !== null ? typeFilterValue : (currentFilterElement?.value || '')
  );
  const selectedTypeFilterKey = normalizeReferenceDocumentIdentityPart(selectedTypeFilter);
  if (checkedValues instanceof Set) {
    checkedValues.forEach(value => duplicateSelectedDocumentValues.add(value));
  }
  syncDuplicateSelectedDocumentValues(container);
  const preservedCheckedValues = duplicateSelectedDocumentValues;

  // Vérifier qu'un projet est sélectionné
  if (!selectedProject) {
    container.innerHTML = '<p style="color: red;">Veuillez sélectionner un projet avant de dupliquer une ligne.</p>';
    return;
  }

  // Obtenir les options disponibles dans la deuxième liste déroulante
  const typeOptions = collectReferenceDocumentTypesFromRecords(selectedProject);
  const typeFilterHTML = `
        <label class="duplicate-filter-row" for="duplicateTypeDocumentFilter">
          <span>Type document</span>
          <select id="duplicateTypeDocumentFilter">
            <option value="">Tous les types</option>
            ${typeOptions.map(type => `
              <option value="${escapeHtml(type)}"${normalizeReferenceDocumentIdentityPart(type) === selectedTypeFilterKey ? ' selected' : ''}>
                ${escapeHtml(type)}
              </option>
            `).join('')}
          </select>
        </label>
      `;

  const documentOptions = collectProjectDocumentEntries(selectedProject, selectedTypeFilter)
    .filter(entry => entry.value && !isCurrentDuplicateDocumentEntry(entry, selectedDocument))
    .map(entry => ({
      value: entry.value,
      label: entry.label,
      type: normalizeTypeDocument(entry.type),
      zone: normalizeZoneValue(entry.zone),
      name: entry.name,
      numero: entry.numero,
    }));
  const showZoneSections = showZones || documentOptions.some(option => normalizeZoneValue(option.zone));

  const emptyMessage = selectedTypeFilter
    ? 'Aucun autre document disponible pour ce type.'
    : 'Aucun autre document disponible pour ce projet.';

  // Générer les cases à cocher pour chaque document disponible
  const listHTML = buildGroupedDuplicateDocumentList(documentOptions, showZoneSections, preservedCheckedValues);

  // Afficher la liste complète avec recherche, compteur et actions de sélection.
  container.innerHTML = `
        <div class="duplicate-toolbar">
          <label for="duplicateDocumentSearch">
            Rechercher un document
            <input type="search" id="duplicateDocumentSearch" placeholder="Nom, numéro, zone…" autocomplete="off">
          </label>
          ${typeFilterHTML}
        </div>
        <div class="duplicate-list-actions">
          <button type="button" id="selectVisibleDocuments">Tout sélectionner (filtrés)</button>
          <button type="button" id="clearSelectedDocuments">Tout désélectionner</button>
          <span id="duplicateSelectionCount" class="duplicate-selection-count"></span>
        </div>
        <div id="documentList" class="duplicate-document-list">
          ${documentOptions.length > 0 ? listHTML : `<p class="duplicate-empty-message">${emptyMessage}</p>`}
          <p id="duplicateSearchEmpty" class="duplicate-empty-message" hidden>Aucun document ne correspond à la recherche.</p>
        </div>
      `;

  // Ajouter un écouteur à la case "Tout sélectionner" pour cocher/décocher tous les documents
  const typeFilter = document.getElementById('duplicateTypeDocumentFilter');
  typeFilter?.addEventListener('change', function () {
    syncDuplicateSelectedDocumentValues(container);
    renderDocumentCheckboxList(this.value);
  });

  const docCheckboxes = container.querySelectorAll("input[name='documents']");
  docCheckboxes.forEach(cb => {
    cb.addEventListener('change', function () {
      if (this.checked) {
        duplicateSelectedDocumentValues.add(this.value);
      } else {
        duplicateSelectedDocumentValues.delete(this.value);
      }
      refreshDuplicateSelectionUi();
    });
  });

  document.getElementById('duplicateDocumentSearch')?.addEventListener('input', event => {
    filterDuplicateDocumentList(event.target.value);
  });

  document.getElementById('selectVisibleDocuments')?.addEventListener('click', () => {
    getVisibleDuplicateDocumentCheckboxes().forEach(cb => {
      cb.checked = true;
      duplicateSelectedDocumentValues.add(cb.value);
    });
    refreshDuplicateSelectionUi();
  });

  document.getElementById('clearSelectedDocuments')?.addEventListener('click', () => {
    duplicateSelectedDocumentValues.clear();
    docCheckboxes.forEach(cb => { cb.checked = false; });
    refreshDuplicateSelectionUi();
  });

  refreshDuplicateSelectionUi();
}

document.getElementById('duplicateCheckbox').addEventListener('change', async function () {
  const container = document.getElementById('duplicateOptionsContainer');
  if (this.checked) {
    resetDuplicateSelectedDocumentValues();
    container.hidden = false;
    await renderDocumentCheckboxList(); // Charger les documents disponibles pour duplication
  } else {
    resetDuplicateSelectedDocumentValues();
    container.hidden = true;
    container.innerHTML = '';
  }
  updateDuplicateSelectionSummary();
});

// Le contexte sera repris proprement à la prochaine ouverture du formulaire.
document.getElementById('secondColumnListbox').addEventListener('change', () => {
  updateReferenceDialogContext('add');
});

// Fonction pour réinitialiser et assurer qu'il y a une seule case personnalisée vide et décochée
function initializeCustomEmitters() {
  const container = document.getElementById('emetteurDropdown');

  // Supprime toutes les anciennes cases personnalisées
  document.querySelectorAll('.custom-emetteur').forEach(row => row.remove());

  // Ajoute une seule case personnalisée vide et décochée
  addCustomEmetteurRow(false);
}

// Fonction pour réinitialiser la boîte de dialogue "Ajouter un document"
async function resetAddDocumentDialog() {
  // Réinitialiser les champs texte et date
  document.getElementById('documentNumber').value = '';
  document.getElementById('documentName').value = '';
  document.getElementById('documentZone').value = '';
  document.getElementById('defaultDureeLimite').value = '';
  await refreshReferenceTypeSuggestionLists(selectedFirstValue);
  const typeSel = document.getElementById('documentType');
  if (typeSel) typeSel.value = '';

  // Récupérer le projet sélectionné
  const selectedProject = document.getElementById('firstColumnDropdown').value;
  if (!selectedProject) {
    console.error("Aucun projet sélectionné !");
    return;
  }

  refreshZoneSuggestionList('documentZoneList', selectedProject);

  // Liste par défaut d'émetteurs
  const defaultEmetteurs = await getDefaultEmetteurs();

  // Extraire les émetteurs du projet à partir de records
  const projectEmetteurs = [...new Set(
    records
      .filter(r => r.NomProjet === selectedProject)
      .map(r => r.Emetteur)
      .filter(Boolean)
  )];

  // Remplir la div avec la fonction dédiée
  populateEmetteurDropdown(projectEmetteurs, defaultEmetteurs);

  if (currentContextMenuEmitter) {
    const checkboxes = document.querySelectorAll('#emetteurDropdown input[type="checkbox"]');
    checkboxes.forEach(cb => {
      cb.checked = (cb.value === currentContextMenuEmitter);
    });
  }

  // Réinitialiser les éventuels éléments de personnalisation (si présents)
  const customCheckbox = document.getElementById('customEmetteurCheckbox');
  if (customCheckbox) customCheckbox.checked = false;
  const customInput = document.getElementById('customEmetteurInput');
  if (customInput) customInput.value = '';
}

// Fonction pour ajouter un nouvel émetteur personnalisé
function addCustomEmetteurRow() {
  const container = document.getElementById('emetteurDropdown');

  // Vérifier s'il y a déjà une ligne et si la dernière est cochée
  const allCustomRows = container.querySelectorAll('.custom-emetteur');
  if (allCustomRows.length > 0) {
    const lastCheckbox = allCustomRows[allCustomRows.length - 1].querySelector('input[type="checkbox"]');
    if (!lastCheckbox.checked) {
      return; // Ne pas ajouter si la dernière case est décochée
    }
  }

  // Création de la ligne d'émetteur personnalisé
  const newEmetteurRow = document.createElement('div');
  newEmetteurRow.classList.add('emetteur-item', 'custom-emetteur');

  // Case à cocher pour l'émetteur
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.classList.add('custom-emetteur-checkbox');
  checkbox.checked = false; // Toujours décoché au début

  // Champ texte pour le nom de l'émetteur
  const textInput = document.createElement('input');
  textInput.type = 'text';
  textInput.placeholder = 'Autre émetteur...';
  textInput.style.flex = '1';
  textInput.style.padding = '5px';

  // Gestion du comportement lors du changement d'état de la case à cocher
  checkbox.addEventListener('change', function () {
    if (this.checked) {
      // Ajouter une nouvelle case seulement si celle-ci est la dernière
      if (!newEmetteurRow.nextElementSibling) {
        addCustomEmetteurRow();
      }
    } else {
      // Si la case est décochée, toutes les suivantes remontent et la dernière est supprimée
      removeCustomEmitter(newEmetteurRow);
    }
  });

  // Ajout des éléments dans la ligne
  newEmetteurRow.appendChild(checkbox);
  newEmetteurRow.appendChild(textInput);

  // Ajout dans le container
  container.appendChild(newEmetteurRow);
}

// Fonction pour gérer la suppression et le décalage des cases personnalisées
function removeCustomEmitter(rowToRemove) {
  const container = document.getElementById('emetteurDropdown');
  const allRows = Array.from(container.querySelectorAll('.custom-emetteur'));
  const indexToRemove = allRows.indexOf(rowToRemove);

  // Si c'est la seule case, elle doit rester décochée et vide
  if (allRows.length === 1) {
    rowToRemove.querySelector('input[type="checkbox"]').checked = false;
    rowToRemove.querySelector('input[type="text"]').value = '';
    return;
  }

  // Décalage des valeurs des cases suivantes vers le haut
  for (let i = indexToRemove; i < allRows.length - 1; i++) {
    const currentCheckbox = allRows[i].querySelector('input[type="checkbox"]');
    const currentTextInput = allRows[i].querySelector('input[type="text"]');
    const nextCheckbox = allRows[i + 1].querySelector('input[type="checkbox"]');
    const nextTextInput = allRows[i + 1].querySelector('input[type="text"]');

    currentCheckbox.checked = nextCheckbox.checked;
    currentTextInput.value = nextTextInput.value;
  }

  // Supprime la dernière case si ce n'est pas la seule restante
  allRows[allRows.length - 1].remove();
}

function collectProjectReferenceEmitters(projectName) {
  const project = _norm(projectName);
  if (!project) return [];

  return (Array.isArray(records) ? records : [])
    .filter((record) =>
      [record?.NomProjetString, record?.NomProjet, record?.Nom_projet]
        .some((value) => _norm(value) === project)
    )
    .map((record) => _norm(record?.Emetteur))
    .filter(Boolean);
}

async function updateEmetteurList(excludeCustom = false, targetDropdownId = "emetteurDropdown") {
  const selectedProject = document.getElementById('firstColumnDropdown').value;
  if (!selectedProject) return;

  try {
    // Liste des émetteurs prédéfinis
    const defaultEmetteurs = await getDefaultEmetteurs();

    const emetteursFromProject = collectProjectReferenceEmitters(selectedProject);

    // Supprimer les doublons et trier
    let uniqueEmetteursFromProject = [...new Set(emetteursFromProject)]
      .filter(emetteur => emetteur && !defaultEmetteurs.includes(emetteur))
      .sort();

    console.log(`Émetteurs trouvés pour ${selectedProject} :`, uniqueEmetteursFromProject);

    // Exclure les émetteurs personnalisés si demandé
    if (excludeCustom) {
      uniqueEmetteursFromProject = uniqueEmetteursFromProject.filter(emetteur => defaultEmetteurs.includes(emetteur));
    }

    // Mise à jour de la liste
    populateDatalist(targetDropdownId, [...defaultEmetteurs, ...uniqueEmetteursFromProject]);

  } catch (error) {
    console.error("Erreur lors de la récupération des émetteurs :", error);
  }
}

function populateEmetteurDropdown(projectEmetteurs, defaultEmetteurs) {
  const container = document.getElementById('emetteurDropdown');
  container.innerHTML = ''; // Vider la div avant de la remplir

  // --- Ajout de la case "Tout sélectionner" ---
  const selectAllDiv = document.createElement('div');
  selectAllDiv.classList.add('emetteur-item');

  const selectAllCheckbox = document.createElement('input');
  selectAllCheckbox.type = 'checkbox';
  selectAllCheckbox.id = 'selectAllEmitters';
  selectAllCheckbox.dataset.selectAll = 'true';

  const selectAllLabel = document.createElement('span');
  selectAllLabel.textContent = 'Tout sélectionner';

  selectAllDiv.appendChild(selectAllCheckbox);
  selectAllDiv.appendChild(selectAllLabel);
  container.appendChild(selectAllDiv);

  // Écouteur d'événement pour gérer la sélection/désélection de toutes les cases
  selectAllCheckbox.addEventListener('change', function () {
    // On récupère toutes les cases à cocher sauf celle "Tout sélectionner" et celles de type "Autre émetteur"
    const emitterCheckboxes = container.querySelectorAll("input[type='checkbox']:not(#selectAllEmitters):not(.custom-emetteur-checkbox)");
    emitterCheckboxes.forEach(cb => {
      cb.checked = selectAllCheckbox.checked;
    });
  });

  // Création de la liste combinée des émetteurs (sans doublons et triée)
  const allEmetteurs = [...defaultEmetteurs, ...projectEmetteurs]
    .filter((v, i, a) => a.indexOf(v) === i)
    .sort((a, b) => a.localeCompare(b, 'fr', { sensitivity: 'base' }));

  allEmetteurs.forEach(emetteur => {
    const emetteurItem = document.createElement('div');
    emetteurItem.classList.add('emetteur-item');

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = emetteur;
    // Pré-sélection si applicable (exemple pour action contextuelle)
    checkbox.checked = (emetteur === currentContextMenuEmitter);

    // Si une case individuelle est décochée, on décoche "Tout sélectionner"
    checkbox.addEventListener('change', function () {
      if (!this.checked) {
        const selectAll = document.getElementById('selectAllEmitters');
        if (selectAll) selectAll.checked = false;
      }
    });

    const label = document.createElement('span');
    label.textContent = emetteur;

    emetteurItem.appendChild(checkbox);
    emetteurItem.appendChild(label);
    container.appendChild(emetteurItem);
  });

  // Ajout de la ligne pour un émetteur personnalisé ("Autre émetteur")
  addCustomEmetteurRow();
}

document.getElementById('firstColumnDropdown').addEventListener('change', function () {
  updateEmetteurList();
});

function populateDatalist(datalistId, values) {
  const datalist = document.getElementById(datalistId);
  if (!datalist) {
    console.error(`Erreur : Datalist ${datalistId} introuvable.`);
    return;
  }
  datalist.innerHTML = ''; // Vider la liste existante
  values.forEach(value => {
    const option = document.createElement('option');
    option.value = value;
    datalist.appendChild(option);
  });
}

document.getElementById('addDocumentDialog').addEventListener('show', () => {
  resetAddDocumentDialog();
});

function updateEmetteurListForAddRow() {
  updateEmetteurList(true, "emetteur");
}

async function updateEmetteurListForInputs() {
  const defaultEmetteurs = await getDefaultEmetteurs();
  updateEmetteurList(true, "emetteurList");
  const selectedProject = document.getElementById('firstColumnDropdown')?.value;
  if (!selectedProject) return;

  if (!Array.isArray(records)) {
    console.error("Erreur : records est vide ou introuvable.");
    return;
  }

  const projectEmetteurs = records
    .filter(record => record.NomProjet === selectedProject)
    .map(record => record.Emetteur)
    .filter((value, index, self) => value && self.indexOf(value) === index)
    .sort((a, b) => a.localeCompare(b, 'fr', { sensitivity: 'base' }));

  const allEmetteurs = [...new Set([...defaultEmetteurs, ...projectEmetteurs])]
    .sort((a, b) => a.localeCompare(b, 'fr', { sensitivity: 'base' }));

  updateDatalist('emetteurList', allEmetteurs);
  updateDatalist('editEmetteurList', allEmetteurs);
}

// Fonction pour remplir une liste `datalist`
function updateDatalist(listId, values) {
  const datalist = document.getElementById(listId);
  if (!datalist) {
    console.error(`Erreur : Datalist ${listId} introuvable.`);
    return;
  }
  datalist.innerHTML = ''; // Vider la liste existante
  values.forEach(value => {
    const option = document.createElement('option');
    option.value = value;
    datalist.appendChild(option);
  });
}

document.getElementById('editEmetteur').addEventListener('input', (event) => {
  currentEditEmetteur = event.target.value.trim();
  console.log("Valeur capturée dans l'émetteur :", currentEditEmetteur);
});

async function updateEditEmetteurList() {
  const selectedProject = document.getElementById('firstColumnDropdown').value;
  const emetteurList = document.getElementById('editEmetteurList');

  if (!selectedProject) {
    emetteurList.innerHTML = '';
    return;
  }

  const defaultEmetteurs = await getDefaultEmetteurs();

  const projectEmetteurs = records
    .filter(record => record.NomProjet === selectedProject)
    .map(record => record.Emetteur)
    .filter((value, index, self) => value && self.indexOf(value) === index)
    .sort((a, b) => a.localeCompare(b, 'fr', { sensitivity: 'base' }));

  const allEmetteurs = [...new Set([...defaultEmetteurs, ...projectEmetteurs])]
    .sort((a, b) => a.localeCompare(b, 'fr', { sensitivity: 'base' }));

  emetteurList.innerHTML = '';
  allEmetteurs.forEach(emetteur => {
    const option = document.createElement('option');
    option.value = emetteur;
    emetteurList.appendChild(option);
  });

  console.log("Liste des émetteurs mise à jour pour l'édition :", allEmetteurs);
}

document.getElementById('editRowDialog').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (referenceFormBusyState.edit || !validateReferenceRowForm('edit')) return;
  if (referenceEditInitialSnapshot && getReferenceFormSnapshot('edit') === referenceEditInitialSnapshot) {
    setReferenceFormStatus('edit', 'Aucune modification à enregistrer.', 'info');
    return;
  }
  if (!selectedRecordId) {
    setReferenceFormStatus('edit', 'La ligne à modifier est introuvable.', 'error');
    return;
  }

  const formData = new FormData(e.target);
  const dureeLimite = String(formData.get('dureeLimite') || '').trim();
  setReferenceFormBusy('edit', true, 'Enregistrement des modifications…');

  try {
    const currentRecord = records.find(record => Number(record.id) === Number(selectedRecordId));
    if (!currentRecord) throw new Error('La ligne a été supprimée ou n’est plus disponible.');

    const planningTableForLimits = await fetchReferencePlanningTableForLimits();
    const editDureeLimiteInput = document.getElementById('editDureeLimite');
    const savedDurationValue = String(editDureeLimiteInput?.dataset?.initialValue ?? '').trim();
    const referenceLimitFields =
      !dureeLimite && !savedDurationValue && !currentRecord.Bloquant
      ? {
          DureeLimite: currentRecord.DureeLimite ?? '',
          DateLimite: currentRecord.DateLimite || DEFAULT_REFERENCE_DATE,
        }
      : buildReferenceLimitFields({
          planningTable: planningTableForLimits,
          projectName: currentRecord.NomProjet || selectedFirstValue,
          documentInfo: {
            numero: currentRecord.NumeroDocument,
            name: currentRecord.NomDocument,
            type: currentRecord.Type_document,
            zone: currentRecord.Zone,
          },
          durationWeeks: dureeLimite,
          useZeroWhenEmpty: Boolean(currentRecord.Bloquant),
          service: currentRecord.Service,
        });
    const updatedRow = sanitizeReferences2DialogFields(withComputedReferenceRetard({
      Emetteur: String(formData.get('editEmetteur') || '').trim(),
      Reference: String(formData.get('reference') || '').trim(),
      Indice: String(formData.get('indice') || '').trim(),
      Recu: String(formData.get('recu') || '').trim() || DEFAULT_REFERENCE_DATE,
      DescriptionObservations: String(formData.get('description') || '').trim(),
      Remarque: normalizeRemarqueValue(formData.get('remarque')),
      ...referenceLimitFields,
    }));

    const duplicateCandidate = { ...currentRecord, ...updatedRow };
    if (findReferenceDialogDuplicate(duplicateCandidate, { ignoreRecordId: selectedRecordId })) {
      setReferenceFormStatus(
        'edit',
        'Une référence identique existe déjà sur ce document. Modifiez la référence ou l’indice.',
        'error'
      );
      return;
    }

    console.log("Mise à jour envoyée à Grist :", updatedRow);
    await grist.docApi.applyUserActions([
      ['UpdateRecord', 'References2', selectedRecordId, updatedRow]
    ]);
    console.log("Mise à jour réussie !");
    await populateTable();
    document.getElementById('editRowDialog').close();
    showReferenceToast('Référence modifiée avec succès.');
  } catch (error) {
    console.error("Erreur lors de la mise à jour :", error);
    setReferenceFormStatus(
      'edit',
      `Impossible de modifier la référence${error?.message ? ` : ${error.message}` : '.'}`,
      'error'
    );
  } finally {
    setReferenceFormBusy('edit', false);
  }
});

// Met à jour la liste si l'utilisateur change de projet avant d'éditer une ligne
document.getElementById('firstColumnDropdown').addEventListener('change', updateEditEmetteurList);

// Fonction pour forcer la mise à jour des émetteurs après modification
function refreshEmetteurList() {
  updateEmetteurListForInputs(); // Recharge les valeurs dans `datalist`
}

// Écoute l'événement de fermeture du dialogue après modification
document.getElementById('editRowDialog').addEventListener('close', refreshEmetteurList);

// Rafraîchir les émetteurs après modification
document.getElementById('editRowDialog').addEventListener('close', () => {
  resetReferenceFilePicker('edit');
  clearReferenceFormErrors('edit');
  setReferenceFormStatus('edit');
  referenceEditInitialSnapshot = '';
  const rows = document.querySelectorAll('#tableBody tr');
  rows.forEach(row => row.classList.remove('highlighted'));
});

document.getElementById('addRowDialog').addEventListener('close', () => {
  resetReferenceFilePicker('add');
  clearReferenceFormErrors('add');
  setReferenceFormStatus('add');
  resetDuplicateSelectedDocumentValues();
  const rows = document.querySelectorAll('#tableBody tr');
  rows.forEach(row => row.classList.remove('highlighted'));
});

async function updateEmetteurList(excludeCustom = false, targetDropdownIds = ["emetteurList", "editEmetteurList"]) {
  // Si targetDropdownIds est une chaîne, la convertir en tableau
  if (typeof targetDropdownIds === "string") {
    targetDropdownIds = [targetDropdownIds];
  }

  const selectedProject = document.getElementById('firstColumnDropdown').value;
  if (!selectedProject) return;

  try {
    // Liste par défaut
    const defaultEmetteurs = await getDefaultEmetteurs();

    const emetteursFromProject = collectProjectReferenceEmitters(selectedProject);

    // Supprimer les doublons et conserver uniquement ceux qui ne sont pas dans defaultEmetteurs
    let uniqueEmetteursFromProject = [...new Set(emetteursFromProject)]
      .filter(emetteur => emetteur && !defaultEmetteurs.includes(emetteur))
      .sort((a, b) => a.localeCompare(b, 'fr', { sensitivity: 'base' }));

    // Si excludeCustom est true, ne garder que ceux de defaultEmetteurs
    if (excludeCustom) {
      uniqueEmetteursFromProject = uniqueEmetteursFromProject.filter(emetteur => defaultEmetteurs.includes(emetteur));
    }

    // Fusionner et trier la liste finale
    let finalEmetteurList = [...defaultEmetteurs, ...uniqueEmetteursFromProject]
      .sort((a, b) => a.localeCompare(b, 'fr', { sensitivity: 'base' }));

    // Pour la cible "emetteurList" (formulaire Ajouter une ligne),
    // si l'input contient une valeur personnalisée non présente, l'ajouter
    if (targetDropdownIds.includes("emetteurList")) {
      const emitterInput = document.getElementById('emetteur');
      const currentValue = emitterInput.value.trim();
      if (currentValue && !finalEmetteurList.includes(currentValue)) {
        finalEmetteurList.push(currentValue);
        finalEmetteurList.sort((a, b) => a.localeCompare(b, 'fr', { sensitivity: 'base' }));
      }
    }

    // Mettre à jour chaque datalist ciblée
    targetDropdownIds.forEach(targetId => populateDatalist(targetId, finalEmetteurList));
  } catch (error) {
    console.error("Erreur lors de la récupération des émetteurs :", error);
  }
}

document.getElementById('emetteur').addEventListener('blur', () => {
  updateEmetteurList(false, "emetteurList");
});

document.getElementById('firstColumnDropdown').addEventListener('change', () => {
  updateEmetteurList(true, ["editEmetteurList"]);
});

async function getDefaultEmetteurs() {
  try {
    const emitterTable = await grist.docApi.fetchTable('Emetteurs');
    if (emitterTable && emitterTable.Emetteurs && emitterTable.Emetteurs.length > 0) {
      return emitterTable.Emetteurs.filter(val => !!val)
        .sort((a, b) => a.localeCompare(b, 'fr', { sensitivity: 'base' }));
    }
    return [];
  } catch (error) {
    console.error("Erreur lors de la récupération des émetteurs par défaut :", error);
    return [];
  }
}

async function getTeamService() {
  const isCensoredCell = (value) => {
    if (value == null || value === '') return true;
    if (Array.isArray(value) && value[0] === 'C') return true;
    const normalized = String(value).trim().toUpperCase();
    return normalized === 'C' || normalized === 'CENSORED';
  };
  const normalizeRows = (raw) => {
    if (!raw) return [];
    if (Array.isArray(raw)) return raw;
    if (Array.isArray(raw.records)) {
      return raw.records.map((record) => record?.fields ? { id: record.id, ...record.fields } : record);
    }
    if (typeof raw !== 'object') return [];
    const keys = Object.keys(raw);
    const rowCount = Math.max(0, ...keys.map((key) => Array.isArray(raw[key]) ? raw[key].length : 0));
    return Array.from({ length: rowCount }, (_, index) =>
      Object.fromEntries(keys.map((key) => [key, Array.isArray(raw[key]) ? raw[key][index] : undefined]))
    );
  };

  const teamTable = await grist.docApi.fetchTable('Team');
  const currentRows = normalizeRows(teamTable).filter((row) => !isCensoredCell(row?.Moi));
  if (currentRows.length !== 1) {
    throw new Error(
      currentRows.length === 0
        ? 'Utilisateur non reconnu dans Team : aucune ligne Moi lisible.'
        : 'Utilisateur ambigu dans Team : plusieurs lignes Moi sont lisibles.'
    );
  }
  const service = String(currentRows[0]?.Service ?? '').trim();
  if (!service || isCensoredCell(currentRows[0]?.Service)) {
    throw new Error("Le service de l'utilisateur courant est vide ou inaccessible dans Team.");
  }
  return service;
}

// Fonction pour retirer l'extension d'un fichier
function removeFileExtension(fileName) {
  return fileName.replace(/\.[^/.]+$/, ""); // Supprime tout après le dernier point
}

function handleAddMultipleTable() {
  openUnifiedAddDocumentsDialog();
}

function resetAddMultipleDocumentDialog() {
  const dialog = document.getElementById('addMultipleDocumentDialog');
  const inputs = dialog.querySelectorAll('input, textarea, select');
  inputs.forEach(input => {
    if (input.type === 'checkbox') {
      input.checked = false;
    } else {
      input.value = '';
    }
  });
  refreshReferenceTypeSuggestionLists(selectedFirstValue);
  const typeSel = document.getElementById('multipleDocumentType');
  if (typeSel) typeSel.value = '';
  const zoneInput = document.getElementById('multipleDocumentZone');
  if (zoneInput) zoneInput.value = '';

  // Réinitialiser le tableau dynamique
  const tbody = document.getElementById('documentTableBody');
  // Supprime toutes les lignes existantes
  tbody.innerHTML = '';
  // Crée une nouvelle ligne vide initiale
  const newRow = document.createElement('tr');

  const tdNumber = document.createElement('td');
  tdNumber.style.border = "1px solid #ddd";
  tdNumber.style.padding = "8px";
  tdNumber.contentEditable = "true";
  // Pour forcer la saisie numérique, nous ajouterons l'écouteur dans addInputListenerToRow()
  newRow.appendChild(tdNumber);

  const tdName = document.createElement('td');
  tdName.style.border = "1px solid #ddd";
  tdName.style.padding = "8px";
  tdName.contentEditable = "true";
  newRow.appendChild(tdName);

  tbody.appendChild(newRow);
  // Attache les écouteurs à la nouvelle ligne
  addInputListenerToRow(newRow);

  // Réinitialiser la liste des émetteurs dans le dialog
  refreshZoneSuggestionList('multipleDocumentZoneList', selectedFirstValue);
  getDefaultEmetteurs().then(defaultEmetteurs => {
    const projectEmetteurs = records
      .filter(record => record.NomProjet === selectedFirstValue)
      .map(record => record.Emetteur)
      .filter((value, index, self) => value && self.indexOf(value) === index)
      .sort((a, b) => a.localeCompare(b, 'fr', { sensitivity: 'base' }));
    populateEmetteurDropdownForContainer('multipleEmetteurDropdown', projectEmetteurs, defaultEmetteurs);
  });
}

function populateEmetteurDropdownForContainer(containerId, projectEmetteurs, defaultEmetteurs) {
  const container = document.getElementById(containerId);
  container.innerHTML = ''; // Vider le conteneur

  // Ajout de la case "Tout sélectionner"
  const selectAllDiv = document.createElement('div');
  selectAllDiv.classList.add('emetteur-item');

  const selectAllCheckbox = document.createElement('input');
  selectAllCheckbox.type = 'checkbox';
  selectAllCheckbox.id = containerId + '_selectAll';
  selectAllCheckbox.dataset.selectAll = 'true';

  const selectAllLabel = document.createElement('span');
  selectAllLabel.textContent = 'Tout sélectionner';

  selectAllDiv.appendChild(selectAllCheckbox);
  selectAllDiv.appendChild(selectAllLabel);
  container.appendChild(selectAllDiv);

  // Gestion du clic sur "Tout sélectionner"
  selectAllCheckbox.addEventListener('change', function () {
    const emitterCheckboxes = container.querySelectorAll("input[type='checkbox']:not(#" + containerId + "_selectAll):not(.custom-emetteur-checkbox)");
    emitterCheckboxes.forEach(cb => {
      cb.checked = selectAllCheckbox.checked;
    });
  });

  // Création de la liste combinée des émetteurs (sans doublons et triée)
  const allEmetteurs = [...defaultEmetteurs, ...projectEmetteurs]
    .filter((v, i, a) => a.indexOf(v) === i)
    .sort((a, b) => a.localeCompare(b, 'fr', { sensitivity: 'base' }));

  allEmetteurs.forEach(emetteur => {
    const emetteurItem = document.createElement('div');
    emetteurItem.classList.add('emetteur-item');

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = emetteur;
    // (Optionnel) Pré-sélection si besoin
    checkbox.checked = (emetteur === currentContextMenuEmitter);

    checkbox.addEventListener('change', function () {
      if (!this.checked) {
        const selectAll = document.getElementById(containerId + '_selectAll');
        if (selectAll) selectAll.checked = false;
      }
    });

    const label = document.createElement('span');
    label.textContent = emetteur;

    emetteurItem.appendChild(checkbox);
    emetteurItem.appendChild(label);
    container.appendChild(emetteurItem);
  });

  // Ajout de la ligne pour un émetteur personnalisé ("Autre émetteur")
  addCustomEmetteurRowForContainer(containerId);
}

// Fonction similaire à addCustomEmetteurRow, mais qui ajoute dans le conteneur cible
function addCustomEmetteurRowForContainer(containerId) {
  const container = document.getElementById(containerId);
  const allCustomRows = container.querySelectorAll('.custom-emetteur');
  if (allCustomRows.length > 0) {
    const lastCheckbox = allCustomRows[allCustomRows.length - 1].querySelector('input[type="checkbox"]');
    if (lastCheckbox && !lastCheckbox.checked) {
      return; // Ne pas ajouter si la dernière case personnalisée n'est pas cochée
    }
  }
  const newEmetteurRow = document.createElement('div');
  newEmetteurRow.classList.add('emetteur-item', 'custom-emetteur');

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.classList.add('custom-emetteur-checkbox');
  checkbox.checked = false;

  const textInput = document.createElement('input');
  textInput.type = 'text';
  textInput.placeholder = 'Autre émetteur...';
  textInput.style.flex = '1';
  textInput.style.padding = '5px';

  checkbox.addEventListener('change', function () {
    if (this.checked) {
      if (!newEmetteurRow.nextElementSibling) {
        addCustomEmetteurRowForContainer(containerId);
      }
    } else {
      removeCustomEmitterForContainer(newEmetteurRow, containerId);
    }
  });

  newEmetteurRow.appendChild(checkbox);
  newEmetteurRow.appendChild(textInput);
  container.appendChild(newEmetteurRow);
}

function removeCustomEmitterForContainer(rowToRemove, containerId) {
  const container = document.getElementById(containerId);
  const allRows = Array.from(container.querySelectorAll('.custom-emetteur'));
  const indexToRemove = allRows.indexOf(rowToRemove);

  if (allRows.length === 1) {
    rowToRemove.querySelector('input[type="checkbox"]').checked = false;
    rowToRemove.querySelector('input[type="text"]').value = '';
    return;
  }

  for (let i = indexToRemove; i < allRows.length - 1; i++) {
    const currentCheckbox = allRows[i].querySelector('input[type="checkbox"]');
    const currentTextInput = allRows[i].querySelector('input[type="text"]');
    const nextCheckbox = allRows[i + 1].querySelector('input[type="checkbox"]');
    const nextTextInput = allRows[i + 1].querySelector('input[type="text"]');
    currentCheckbox.checked = nextCheckbox.checked;
    currentTextInput.value = nextTextInput.value;
  }
  allRows[allRows.length - 1].remove();
}

document.getElementById('addMultipleDocumentDialog').addEventListener('submit', async (e) => {
  e.preventDefault();
  let previousSelectionState = null;
  trimInputs(e.target); // Nettoie les espaces superflus

  const documentType = normalizeTypeDocument(document.getElementById('multipleDocumentType')?.value);

  if (!documentType) {
    alert("Veuillez renseigner un type de document.");
    return;
  }

  // Récupérer les lignes du tableau dynamique
  const tbody = document.getElementById('documentTableBody');
  const rows = Array.from(tbody.querySelectorAll('tr'));

  // Filtrer les lignes non complètement vides (on ignore la dernière ligne vide)
  const documentRows = rows.filter((row, index) => {
    const cells = row.querySelectorAll('td');
    const cell1 = cells[0].innerText.trim();
    const cell2 = cells[1].innerText.trim();
    // Si c'est la dernière ligne et qu'elle est vide, on l'ignore
    if (index === rows.length - 1 && cell1 === '' && cell2 === '') {
      return false;
    }
    // On considère la ligne si au moins une cellule est renseignée
    return (cell1 !== '' || cell2 !== '');
  });

  // Vérifier que pour chaque ligne non vide, les deux cellules sont complétées
  for (const row of documentRows) {
    const cells = row.querySelectorAll('td');
    const cell1 = cells[0].innerText.trim();
    const cell2 = cells[1].innerText.trim();
    if ((cell1 === '' && cell2 !== '') || (cell1 !== '' && cell2 === '')) {
      alert("Chaque ligne doit être complétée dans les deux colonnes.");
      return;
    }
  }

  if (documentRows.length === 0) {
    alert("Veuillez remplir au moins une ligne avec un numéro et un nom de document.");
    return;
  }

  // Construire un tableau de données à partir des lignes (chaque ligne contient un numéro et un nom)
  const documentsData = documentRows.map(row => {
    const cells = row.querySelectorAll('td');
    return {
      documentNumber: cells[0].innerText.trim(),
      documentName: cells[1].innerText.trim()
    };
  });

  // Récupérer les émetteurs sélectionnés dans le conteneur du dialog "Ajouter Plusieurs document"
  let serviceValue = '';
  try {
    serviceValue = await getTeamService();
    await assertReferenceDocumentIdentitiesAvailable(
      selectedFirstValue,
      documentsData.map((doc) => ({
        number: doc.documentNumber,
        name: doc.documentName,
        type: documentType,
      })),
      serviceValue
    );
  } catch (error) {
    alert(error.message);
    return;
  }

  const selectedEmitters = Array.from(document.querySelectorAll('#multipleEmetteurDropdown input[type="checkbox"]:checked'))
    .filter(checkbox => {
      const checkboxId = String(checkbox?.id || '');
      return checkbox?.dataset?.selectAll !== 'true' &&
        checkboxId !== 'selectAllEmitters' &&
        !checkboxId.endsWith('_selectAll');
    })
    .map(checkbox => {
      // Pour une case personnalisée, récupérer la valeur saisie dans le champ adjacent
      const textInput = checkbox.nextElementSibling;
      if (textInput && textInput.tagName === "INPUT" && textInput.type === "text") {
        const customValue = textInput.value.trim();
        return customValue ? customValue : null;
      }
      return checkbox.value;
    })
    .filter(value => value); // Exclut les valeurs nulles

  if (selectedEmitters.length === 0) {
    alert("Veuillez sélectionner au moins un émetteur.");
    return;
  }

  // Récupérer le projet sélectionné (stocké dans la variable globale "selectedFirstValue")
  const selectedProject = selectedFirstValue;
  if (!selectedProject) {
    alert("Veuillez sélectionner un projet avant d'ajouter un document.");
    return;
  }

  try {
    // Récupérer l'ID du projet
    const selectedProject = selectedFirstValue;
    if (!selectedProject) throw new Error("Aucun projet sélectionné.");


    const documentZone = resolveReferenceDocumentZone(document.getElementById('multipleDocumentZone')?.value, selectedFirstValue);

    // Récupérer la date limite par défaut
    const defaultDureeLimite = document.getElementById('multipleDefaultDureeLimite')?.value || "";
    if (String(defaultDureeLimite ?? '').trim() && parseReferenceDurationLimit(defaultDureeLimite) == null) {
      alert("La duree limite par defaut doit etre un nombre entier de semaines.");
      return;
    }

    // Construire la liste des actions à appliquer (ListePlan + References)
    const actions = [];

    // 1) Upsert dans ListePlan : 1 ligne par document (pas par émetteur)
    try {
      const plansTableName = await resolveListePlanTableName();
      const plans = await grist.docApi.fetchTable(plansTableName);

      // Index des lignes existantes par projet + numero + type.
      const existing = new Map();
      const projs = plans.Nom_projet || [];
      const nums  = plans.NumeroDocument || [];
      const types = plans.Type_document || [];
      const services = plans.Service || [];
      const ids   = plans.id || [];
      const L = Math.max(projs.length, nums.length, types.length, services.length, ids.length);

      for (let i = 0; i < L; i++) {
        const p = normalizeReferenceDocumentIdentityPart(projs[i]);
        const n = normalizeReferenceDocumentIdentityPart(nums[i]);
        const t = normalizeReferenceDocumentIdentityPart(types[i]);
        const serviceKey = normalizeServiceMatchKey(services[i]);
        if (!p || !n || !t) continue;
        existing.set(`${p}||${n}||${t}||${serviceKey}`, ids[i]);
      }
      const projKey = normalizeReferenceDocumentIdentityPart(selectedProject);

      documentsData.forEach(doc => {
        const numStrPlan = _norm(doc.documentNumber);
        const nm = String(doc.documentName).trim();
        const key = [
          projKey,
          normalizeReferenceDocumentIdentityPart(numStrPlan),
          normalizeReferenceDocumentIdentityPart(documentType),
          normalizeServiceMatchKey(serviceValue),
        ].join('||');

        if (existing.has(key)) {
          actions.push(['UpdateRecord', plansTableName, existing.get(key), {
            Type_document: documentType,
            Zone: documentZone,
            Designation: nm,
          }]);
        } else {
          actions.push(['AddRecord', plansTableName, null, {
            Nom_projet: selectedProject,
            NumeroDocument: numStrPlan,
            Type_document: documentType,
            Zone: documentZone,
            Designation: nm,
            Service: serviceValue
          }]);
          // évite les doublons si deux fois le même numéro est tapé dans le tableau
          existing.set(key, null);
        }
      });

    } catch (err) {
      throw new Error(`ListePlan: impossible de preparer les documents. ${err.message || err}`);
    }

    // 1b) Upsert dans Planning_Projet / Planning_Project : 1 ligne par document
    try {
      const planningTableName = await resolvePlanningTableName();
      const planning = await grist.docApi.fetchTable(planningTableName);
      const planningZoneAnchorAction = buildPlanningZoneAnchorActionIfMissing(
        planningTableName,
        planning,
        selectedProject,
        documentZone,
        serviceValue
      );
      if (planningZoneAnchorAction) {
        actions.push(planningZoneAnchorAction);
      }

      const projKeyPlanning = normalizeReferenceDocumentIdentityPart(selectedProject);
      const pendingPlanningAdds = new Set();
      documentsData.forEach((doc) => {
        const numStrPlanning = _norm(doc.documentNumber);
        const nm = String(doc.documentName).trim();
        const keyPlanning = [
          projKeyPlanning,
          normalizeReferenceDocumentIdentityPart(numStrPlanning),
          normalizeReferenceDocumentIdentityPart(documentType),
          normalizeServiceMatchKey(serviceValue),
        ].join('||');
        const idxPlanning = findPlanningIndex(
          planning,
          selectedProject,
          numStrPlanning,
          documentType,
          documentZone,
          nm,
          serviceValue
        );

        if (idxPlanning >= 0) {
          actions.push([
            'UpdateRecord',
            planningTableName,
            planning.id[idxPlanning],
            buildPlanningDocumentUpdateFields(planning, {
              taskName: nm,
              typeDoc: documentType,
              zoneStr: documentZone
            })
          ]);
        } else if (!pendingPlanningAdds.has(keyPlanning)) {
          actions.push([
            'AddRecord',
            planningTableName,
            null,
            buildPlanningDocumentAddFields(planning, {
              projectName: selectedProject,
              numeroDocStr: numStrPlanning,
              taskName: nm,
              typeDoc: documentType,
              zoneStr: documentZone,
              service: serviceValue
            })
          ]);
          pendingPlanningAdds.add(keyPlanning);
        }
      });
    } catch (err) {
      throw new Error(`Planning: impossible de preparer les documents. ${err.message || err}`);
    }

    // 2) Ajout dans References : 1 ligne par (document × émetteur)
    const planningTableForLimits = await fetchReferencePlanningTableForLimits();
    documentsData.forEach(doc => {
      selectedEmitters.forEach(emetteur => {
        const num = _norm(doc.documentNumber);
        const nm  = String(doc.documentName).trim();
        const referenceLimitFields = buildReferenceLimitFields({
          planningTable: planningTableForLimits,
          projectName: selectedProject,
          documentInfo: {
            documentNumber: num,
            documentName: nm,
            documentType,
            documentZone,
          },
          durationWeeks: defaultDureeLimite,
          service: serviceValue,
        });

        const newRow = withComputedReferenceRetard({
          NomProjet: selectedProject,
          NomDocument: nm,
          NumeroDocument: num,
          Type_document: documentType,
          Zone: documentZone,
          Emetteur: emetteur,
          Reference: '_',
          Indice: '-',
          Recu: '1900-01-01',
          DescriptionObservations: 'EN ATTENTE',
          ...referenceLimitFields,
          Service: serviceValue
        });

        actions.push(['AddRecord', 'References2', null, newRow]);
      });
    });

    // Appliquer les actions via l'API Grist
    const typeDocActions = await buildProjectTypeDocUpdateActions(selectedProject, [documentType]);
    typeDocActions.forEach((action) => actions.unshift(action));
    if (documentsData.length) {
      const lastDoc = documentsData[documentsData.length - 1];
      previousSelectionState = captureDocumentSelectionState();
      queueNewDocumentSelection({
        numero: lastDoc.documentNumber,
        name: String(lastDoc.documentName).trim(),
        zone: documentZone,
        type: documentType,
      });
    }
    await applyUserActionsInChunks(actions);
    await refreshReferenceTypeSuggestionLists(selectedProject);
    selectedTypeValue = '';
    console.log("Documents ajoutés :", documentsData);

    // Mettre à jour le dropdown de documents en ajoutant chaque nouveau document



// Optionnel : sélectionner le dernier document ajouté

// Met à jour l'affichage du tableau principal et ferme le dialog

    if (documentsData.length) {
      restoreLastDocumentSelection();
    }
    document.getElementById('addMultipleDocumentDialog').close();

  } catch (error) {
    restoreDocumentSelectionState(previousSelectionState || {});
    console.error("Erreur lors de l'ajout des documents :", error);
    alert("Une erreur s'est produite lors de l'ajout des documents.");
  }
});

function setCaretToEnd(el) {
  const range = document.createRange();
  const sel = window.getSelection();
  range.selectNodeContents(el);
  range.collapse(false);
  sel.removeAllRanges();
  sel.addRange(range);
}

// Ajoute l'écouteur sur une ligne pour surveiller les modifications
function addInputListenerToRow(row) {
  const firstCell = row.querySelectorAll('td')[0];
  firstCell.addEventListener('input', function () {
    // Conserve la valeur, filtre les caractères non numériques
    const oldText = this.innerText;
    const newText = oldText.replace(/\D/g, '');
    if (newText !== oldText) {
      this.innerText = newText;
      // Replace le curseur à la fin
      setCaretToEnd(this);
    }
    updateDocumentTable();
  });

  // Ajoute l'écouteur pour les autres cellules
  row.querySelectorAll('td').forEach(cell => {
    if (cell !== firstCell) {
      cell.addEventListener('input', updateDocumentTable);
    }
  });
}

// Fonction qui met à jour le tableau
function updateDocumentTable() {
  const tbody = document.getElementById('documentTableBody');
  const rows = Array.from(tbody.querySelectorAll('tr'));

  // Supprime toutes les lignes vides sauf la dernière
  rows.slice(0, -1).forEach(row => {
    const cells = row.querySelectorAll('td');
    let isEmpty = true;
    cells.forEach(cell => {
      if (cell.innerText.trim() !== '') {
        isEmpty = false;
      }
    });
    if (isEmpty) {
      row.remove();
    }
  });

  // Vérifie la dernière ligne
  const lastRow = tbody.lastElementChild;
  if (lastRow) {
    const cells = lastRow.querySelectorAll('td');
    let hasContent = false;
    cells.forEach(cell => {
      if (cell.innerText.trim() !== '') {
        hasContent = true;
      }
    });
    if (hasContent) {
      // Crée une nouvelle ligne vide
      const newRow = document.createElement('tr');

      const td1 = document.createElement('td');
      td1.style.border = "1px solid #ddd";
      td1.style.padding = "8px";
      td1.contentEditable = "true";

      const td2 = document.createElement('td');
      td2.style.border = "1px solid #ddd";
      td2.style.padding = "8px";
      td2.contentEditable = "true";

      newRow.appendChild(td1);
      newRow.appendChild(td2);
      tbody.appendChild(newRow);
      addInputListenerToRow(newRow);
    }
  }
}

// Initialisation : Ajoute l'écouteur sur la première ligne dès le chargement du dialog
document.addEventListener('DOMContentLoaded', () => {
  const initialRow = document.querySelector('#documentTableBody tr');
  if (initialRow) {
    addInputListenerToRow(initialRow);
  }
});

document.getElementById('addMultipleDocumentDialog').addEventListener('show', () => {
  resetAddMultipleDocumentDialog();
});

document.getElementById('cancelAddDocumentButton').addEventListener('click', () => {
  document.getElementById('addDocumentDialog').close();

  const listbox = document.getElementById('secondColumnListbox');
  listbox.value = lastValidDocument || "";
  selectedSecondValue = lastValidDocument || "";

  if (selectedFirstValue && selectedSecondValue) {
    populateTable();
  }
});

document.getElementById('cancelAddMultipleDocumentButton').addEventListener('click', () => {
  document.getElementById('addMultipleDocumentDialog').close();

  const listbox = document.getElementById('secondColumnListbox');
  listbox.value = lastValidDocument || ""; 
  selectedSecondValue = lastValidDocument || "";

  if (selectedFirstValue && selectedSecondValue) {
    populateTable();
  }
});

// Bouton "Télécharger Tableau"
document.getElementById('copyTableDataButton').addEventListener('click', function () {
  // Vérifie qu'un projet et un document sont sélectionnés
  const firstValue = document.getElementById('firstColumnDropdown').value.trim();
  const secondValue = document.getElementById('secondColumnListbox').value.trim();
  if (!firstValue || !secondValue || secondValue === "Sélectionner un étage") {
    alert("Veuillez sélectionner un projet et un document.");
    return;
  }

  // Récupère l'élément du tableau
  const table = document.getElementById('dataTable');
  if (!table) {
    alert("Tableau introuvable !");
    return;
  }

  // Récupère toutes les lignes (en-tête et corps)
  const rows = table.querySelectorAll('tr');
  let tableText = "";

  rows.forEach(row => {
    const cells = row.querySelectorAll('th, td');
    const cellTexts = Array.from(cells)
      .slice(1)           // Supprime la première colonne (ID)
      .slice(0, 5)        // Conserve les 5 premières cellules restantes
      .map(cell => cell.innerText.trim());
    tableText += cellTexts.join('\t') + "\n";
  });

  // Essayer d'utiliser l'API Clipboard pour copier le texte
  navigator.clipboard.writeText(tableText)
    .then(() => {
      alert("Données du tableau copiées dans le presse-papier !");
    })
    .catch(err => {
      console.warn("Clipboard API non disponible, utilisation du fallback.", err);
      // Fallback : créer un textarea temporaire et utiliser document.execCommand('copy')
      const textarea = document.createElement("textarea");
      textarea.value = tableText;
      textarea.style.position = "fixed";
      textarea.style.top = "-1000px";
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      try {
        const successful = document.execCommand('copy');
        if (successful) {
          alert("Données du tableau copiées dans le presse-papier !");
        } else {
          alert("Échec de la copie via execCommand.");
        }
      } catch (err2) {
        alert("Erreur lors de la copie (fallback) : " + err2);
      }
      document.body.removeChild(textarea);
    });
});

document.getElementById('copyTableDataButtonImage').addEventListener('click', async function () {
  // Vérifie qu'un projet et un document sont sélectionnés
  const firstValue = document.getElementById('firstColumnDropdown').value.trim();
  const secondValue = document.getElementById('secondColumnListbox').value.trim();
  if (!firstValue || !secondValue || secondValue === "Sélectionner un étage") {
    alert("Veuillez sélectionner un projet et un document.");
    return;
  }

  const originalTable = document.getElementById('dataTable');
  if (!originalTable) {
    alert("Tableau introuvable !");
    return;
  }

  // Cloner le tableau original (avec toutes ses parties)
  const clonedTable = originalTable.cloneNode(true);

  // Pour éviter que le header ne se positionne en sticky,
  // on modifie le style du thead en position static
  const thead = clonedTable.querySelector('thead');
  if (thead) {
    thead.style.position = 'static';
    thead.style.top = '0';
  }

  // Indices des colonnes à supprimer (en se basant sur l’ordre dans le tableau original)
  // Ici, on souhaite retirer "DateLimite", "Bloquant" et "Archive".
  // Dans notre tableau, ces colonnes se trouvent respectivement aux indices 6, 7 et 8
  // On supprime en partant de la plus grande pour éviter que l’indexation ne soit décalée.
  removeColumnsFromClonedTableByHeaders(clonedTable, ['DateLimite', 'Date limite calculée', 'Bloquant', 'Archive']);

  // Créer un conteneur temporaire dans lequel on place le clone pour le rendre capturable.
  const tempContainer = document.createElement('div');
  tempContainer.style.position = 'absolute';
  tempContainer.style.top = '-9999px';
  tempContainer.style.left = '-9999px';
  tempContainer.style.display = 'block';
  tempContainer.appendChild(clonedTable);
  document.body.appendChild(tempContainer);

  try {
    // Utilisation de html2canvas pour capturer le tableau cloné
    const canvas = await html2canvas(clonedTable, { useCORS: true });

    // Si l'API Clipboard est disponible, essayer de copier l'image dans le presse-papier
    if (navigator.clipboard && navigator.clipboard.write) {
      canvas.toBlob(async function (blob) {
        if (!blob) {
          alert("Erreur lors de la conversion en image.");
          return;
        }
        try {
          const clipboardItem = new ClipboardItem({ 'image/png': blob });
          await navigator.clipboard.write([clipboardItem]);
          alert("Image du tableau copiée dans le presse-papier !");
        } catch (err) {
          console.warn("Erreur lors de l'utilisation de l'API Clipboard, passage au fallback.", err);
          fallbackCopyImage(canvas);
        }
      }, 'image/png');
    } else {
      fallbackCopyImage(canvas);
    }
  } catch (error) {
    alert("Erreur lors de la capture du tableau : " + error);
  } finally {
    document.body.removeChild(tempContainer);
  }
});

// Fallback copier image
function fallbackCopyImage(canvas) {

  const dataURL = canvas.toDataURL('image/png');

  // Crée un conteneur contentEditable hors écran
  const container = document.createElement('div');
  container.contentEditable = true;
  container.style.position = 'absolute';
  container.style.top = '-9999px';
  container.style.left = '-9999px';
  document.body.appendChild(container);

  // Insère l'image dans le conteneur via une balise <img>
  container.innerHTML = `<img src="${dataURL}">`;

  // Sélectionne le contenu du conteneur
  const range = document.createRange();
  range.selectNodeContents(container);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);

  try {
    const success = document.execCommand('copy');
    if (success) {
      alert("Image du tableau copiée dans le presse-papier !");
    } else {
      alert("Échec de la copie de l'image via le fallback.");
    }
  } catch (err) {
    alert("Erreur lors de la copie (fallback) : " + err);
  }

  // Nettoyage
  document.body.removeChild(container);
  selection.removeAllRanges();
}

// Bouton "Télécharger Tableau"
document.getElementById('downloadTableButton').addEventListener('click', async function () {
  // Vérifier qu'un projet et un document sont sélectionnés
  const projectName = document.getElementById('firstColumnDropdown').value.trim();
  const docSelection = parseDocValue(document.getElementById('secondColumnListbox').value.trim());
  const docName = (docSelection.name || '').trim();
  if (!projectName || !docName || docName === "Sélectionner un étage") {
    alert("Veuillez sélectionner un projet et un document.");
    return;
  }

  // Définition du nom
  const suggestedName = `${projectName}_${docName}.png`;

  // Récupérer le tableau original
  const originalTable = document.getElementById('dataTable');
  if (!originalTable) {
    alert("Tableau introuvable !");
    return;
  }

  // Cloner le tableau
  const clonedTable = originalTable.cloneNode(true);

  const thead = clonedTable.querySelector('thead');
  if (thead) {
    thead.style.position = 'static';
    thead.style.top = '0';
  }

  removeColumnsFromClonedTableByHeaders(clonedTable, ['DateLimite', 'Date limite calculée', 'Bloquant', 'Archive']);

  // Créer un conteneur temporaire hors écran pour placer le clone
  const tempContainer = document.createElement('div');
  tempContainer.style.position = 'absolute';
  tempContainer.style.top = '-9999px';
  tempContainer.style.left = '-9999px';
  tempContainer.style.display = 'block';
  tempContainer.appendChild(clonedTable);
  document.body.appendChild(tempContainer);

  try {
    // Capture du clone par html2canvas
    const canvas = await html2canvas(clonedTable, { useCORS: true });
    // Convertir le canvas en Blob (format PNG)
    const blob = await new Promise(resolve => {
      canvas.toBlob(resolve, 'image/png');
    });

    // Si l'API File System Access est disponible, tenter de l'utiliser pour ouvrir le navigateur de fichier
    if (window.showSaveFilePicker) {
      try {
        const options = {
          suggestedName: suggestedName,
          types: [{
            description: 'Images PNG',
            accept: { 'image/png': ['.png'] }
          }]
        };
        // Note : showSaveFilePicker doit être exécuté dans un contexte sécurisé (HTTPS) et au niveau top-level
        const handle = await window.showSaveFilePicker(options);
        const writableStream = await handle.createWritable();
        await writableStream.write(blob);
        await writableStream.close();
      } catch (err) {
        console.error("Erreur avec showSaveFilePicker :", err);
        // Fallback classique en cas d'échec
        fallbackDownload(blob, suggestedName);
      }
    } else {
      // Si l'API n'est pas disponible, utiliser le fallback
      fallbackDownload(blob, suggestedName);
    }
  } catch (error) {
    alert("Erreur lors de la capture du tableau : " + error);
  } finally {
    // Supprimer le conteneur temporaire
    document.body.removeChild(tempContainer);
  }
});

// Fonction fallback : réalise un téléchargement classique via un lien
function fallbackDownload(blob, suggestedName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = suggestedName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
const DOC_SELECT_PLACEHOLDER_TEXT = 'S\u00e9lectionner un \u00e9tage';
const DOC_SELECT_PLACEHOLDER_HTML = `<option value="">${DOC_SELECT_PLACEHOLDER_TEXT}</option>`;

function enforceDocPlaceholderText() {
  const dropdown = document.getElementById('secondColumnListbox');
  if (!dropdown || !dropdown.options || dropdown.options.length === 0) return;
  const firstOption = dropdown.options[0];
  if (firstOption && firstOption.value === '') {
    firstOption.text = DOC_SELECT_PLACEHOLDER_TEXT;
  }
}

function populateSecondColumnListbox(selectedValue, preferredValue = null) {
  const listbox = document.getElementById('secondColumnListbox');
  if (!listbox) return;

  const selectedProject = _norm(selectedValue);
  const selectedType = getCurrentSelectedType();
  const desiredValue = _norm(
    preferredValue != null ? preferredValue : (selectedSecondValue || listbox.value || lastValidDocument)
  );


  listbox.innerHTML = DOC_SELECT_PLACEHOLDER_HTML;

  const documentEntries = collectProjectDocumentEntries(selectedProject, selectedType);
  const hasZones = projectHasStructuredZones(selectedProject);
  const showAllTypes = !selectedType;

  if (showAllTypes) {
    const groupedTypes = new Map();
    documentEntries.forEach((entry) => {
      const typeKey = normalizeTypeDocument(entry.type);
      if (!groupedTypes.has(typeKey)) groupedTypes.set(typeKey, []);
      groupedTypes.get(typeKey).push(entry);
    });

    const orderedTypes = collectProjectDocumentTypes(
      selectedProject,
      Array.from(groupedTypes.keys())
    ).filter((typeKey) => groupedTypes.has(typeKey));

    if (groupedTypes.has('') && !orderedTypes.includes('')) {
      orderedTypes.push('');
    }

    orderedTypes.forEach((typeKey) => {
      const group = document.createElement('optgroup');
      group.label = typeKey || 'Sans type';
      const typeEntries = groupedTypes.get(typeKey) || [];

      if (hasZones) {
        appendZoneOptions(group, typeEntries, true);
      } else {
        typeEntries.forEach((entry) => appendDocumentOption(group, entry));
      }

      listbox.appendChild(group);
    });
  } else if (hasZones) {
    appendZoneOptions(listbox, documentEntries, false);
  } else {
    documentEntries.forEach((entry) => appendDocumentOption(listbox, entry));
  }

  const addOption = document.createElement('option');
  addOption.value = DOC_ADD_SPECIAL_VALUE;
  addOption.text = 'Ajouter documents';
  addOption.style.fontWeight = '700';
  listbox.appendChild(addOption);

  const hasDesiredValue = desiredValue &&
    Array.from(listbox.options).some(option => option.value === desiredValue);
  listbox.value = hasDesiredValue ? desiredValue : '';
  enforceDocPlaceholderText();

  selectedSecondValue = _norm(listbox.value);
  if (selectedSecondValue) {
    lastValidDocument = selectedSecondValue;
    const parsedDoc = parseDocValue(selectedSecondValue);
    selectedDocName = parsedDoc.name || '';
    selectedDocNumber = parseNumeroForStorage(parsedDoc.numero);
    selectedDocZone = normalizeZoneValue(parsedDoc.zone);
  } else {
    lastValidDocument = '';
    selectedDocName = '';
    selectedDocNumber = null;
    selectedDocZone = '';
  }
}

document.getElementById('thirdColumnDropdown').addEventListener('change', function () {
  const tableBody = document.getElementById('tableBody');
  const tableHeader = document.getElementById('tableHeader');

  selectedTypeValue = normalizeTypeDocument(this.value);
  populateZoneDropdown(selectedFirstValue, selectedZoneValue);
  populateSecondColumnListbox(selectedFirstValue, selectedSecondValue || lastValidDocument || '');

  if (selectedFirstValue && selectedSecondValue) {
    populateTable();
    scheduleReferenceRetardReconciliation();
  } else {
    tableBody.innerHTML = '';
    tableHeader.innerHTML = '';
  }
});

document.getElementById('zoneDropdown')?.addEventListener('change', function () {
  const tableBody = document.getElementById('tableBody');
  const tableHeader = document.getElementById('tableHeader');
  const preferredDocument = selectedSecondValue || lastValidDocument || '';

  selectedZoneValue = _norm(this.value || REFERENCE_ALL_ZONES_VALUE);
  populateSecondColumnListbox(selectedFirstValue, preferredDocument);

  if (selectedFirstValue && selectedSecondValue) {
    populateTable();
    scheduleReferenceRetardReconciliation();
  } else {
    if (tableBody) tableBody.innerHTML = '';
    if (tableHeader) tableHeader.innerHTML = '';
  }
});

document.getElementById('firstColumnDropdown').addEventListener('change', function () {
  const project = _norm(this.value);
  saveSharedProjectSelection(project);
  const secondDropdown = document.getElementById('secondColumnListbox');
  const tableBody = document.getElementById('tableBody');
  const tableHeader = document.getElementById('tableHeader');

  selectedFirstValue = project;
  selectedTypeValue = '';
  selectedSecondValue = '';
  lastValidDocument = '';
  selectedZoneValue = REFERENCE_ALL_ZONES_VALUE;
  selectedDocName = '';
  selectedDocNumber = null;
  selectedDocZone = '';

  if (!project) {
    populateTypeDocumentDropdown('');
    resetZoneDropdown(true);
    secondDropdown.disabled = true;
    secondDropdown.innerHTML = DOC_SELECT_PLACEHOLDER_HTML;
    tableBody.innerHTML = '';
    tableHeader.innerHTML = '';
    return;
  }

  populateTypeDocumentDropdown(project);
  populateZoneDropdown(project, REFERENCE_ALL_ZONES_VALUE);
  populateSecondColumnListbox(project, '');
});

try {
  const secondDropdown = document.getElementById('secondColumnListbox');
  if (secondDropdown) {
    secondDropdown.innerHTML = DOC_SELECT_PLACEHOLDER_HTML;
    enforceDocPlaceholderText();
    const placeholderObserver = new MutationObserver(() => {
      enforceDocPlaceholderText();
    });
    placeholderObserver.observe(secondDropdown, { childList: true });
  }
} catch (e) { }

grist.onRecords(function (receivedRecords, tableId) {
  if (tableId === 'Team') return;
  if (!Array.isArray(receivedRecords)) return;

  records = receivedRecords;
  referenceRecordsReady = true;
  scheduleReferenceRetardReconciliation();
  const tableBody = document.getElementById('tableBody');
  const tableHeader = document.getElementById('tableHeader');

  if (!selectedFirstValue) {
    populateTypeDocumentDropdown('');
    resetZoneDropdown(true);
    if (tableBody) tableBody.innerHTML = '';
    if (tableHeader) tableHeader.innerHTML = '';
    return;
  }

  populateTypeDocumentDropdown(selectedFirstValue, selectedTypeValue);
  populateZoneDropdown(selectedFirstValue, selectedZoneValue);
  populateSecondColumnListbox(selectedFirstValue, selectedSecondValue || lastValidDocument || '');
  if (!selectedSecondValue) {
    if (tableBody) tableBody.innerHTML = '';
    if (tableHeader) tableHeader.innerHTML = '';
  }
});

// --- Force labels in the 2nd dropdown to "<NumeroDocument> <NomDocument>" ---
function refreshSecondDropdownLabels() {
  try {
    const projectDropdown = document.getElementById('firstColumnDropdown');
    const secondDropdown = document.getElementById('secondColumnListbox');
    if (!projectDropdown || !secondDropdown) return;
    const selectedProject = (projectDropdown.value || '').trim();
    const options = Array.from(secondDropdown.options);
    options.forEach(opt => {
      if (opt?.disabled) return;
      if (!opt || !opt.value || isSpecialDocumentOptionValue(opt.value)) return;
      let numero = null, name = '';
      try {
        const parsed = parseDocValue(opt.value);
        if (parsed) { numero = parsed.numero; name = parsed.name || String(opt.textContent || '').trim(); }
      } catch (e) { }
      if (!name) name = String(opt.value).trim();
      if (numero === null || numero === undefined) {
  // 1) essayer via records (si la colonne est présente dans la vue)
  try {
    const rec = (records || []).find(r => r.NomProjet === selectedProject && r.NomDocument === name);
    if (rec && (rec.NumeroDocument !== undefined) && rec.NumeroDocument != null) {
      numero = parseNumeroForStorage(rec.NumeroDocument);
    }
  } catch (e) { }

  // 2) fallback via cache (table complète)
  if (numero == null) {
    try {
      const cached = getCachedNumeroDocument(selectedProject, name);
      if (cached != null) numero = cached;
    } catch (e) { }
  }
}
opt.textContent = makeDocLabel(name, numero);
opt.label = opt.textContent;

    });
  } catch (e) { console.warn('refreshSecondDropdownLabels failed:', e); }
}
function installSecondDropdownObserver() {
  try {
    const secondDropdown = document.getElementById('secondColumnListbox');
    if (!secondDropdown) return;
    if (window.__secondDropdownObserver) return;
    const obs = new MutationObserver(() => { try { refreshSecondDropdownLabels(); } catch (e) { } });
    obs.observe(secondDropdown, { childList: true, subtree: false });
    window.__secondDropdownObserver = obs;
    try { refreshSecondDropdownLabels(); } catch (e) { }
  } catch (e) { console.warn('installSecondDropdownObserver failed:', e); }
}
if (document.readyState === 'complete' || document.readyState === 'interactive') {
  try { installSecondDropdownObserver(); } catch (e) { }
  setTimeout(() => { try { refreshSecondDropdownLabels(); installSecondDropdownObserver(); } catch (e) { } }, 200);
} else {
  window.addEventListener('DOMContentLoaded', () => {
    try { installSecondDropdownObserver(); refreshSecondDropdownLabels(); } catch (e) { }
    setTimeout(() => { try { refreshSecondDropdownLabels(); } catch (e) { } }, 200);
  });
}

// Synchronisation inter-widgets : réagit quand un autre widget change le projet sélectionné
(function () {
  if (window.__lpStorageSyncAdded_reference2) return;
  window.__lpStorageSyncAdded_reference2 = true;
  var _nk = function (s) {
    return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim().replace(/\s+/g, ' ');
  };
  window.addEventListener('storage', function (event) {
    if (event.key === REFERENCE_DATA_CHANGE_STORAGE_KEY) {
      scheduleReferenceRetardReconciliation();
      return;
    }

    var dropdown = document.getElementById('firstColumnDropdown');
    if (!dropdown) return;
    if (event.key === 'grist.selected-project-id' && event.newValue) {
      var idStr = String(event.newValue).trim();
      var match = Array.from(dropdown.options).find(function (o) { return o.dataset.projectId === idStr; });
      if (match && dropdown.value !== match.value) {
        dropdown.value = match.value;
        dropdown.dispatchEvent(new Event('change'));
      }
      return;
    }
    if (event.key !== 'grist.selected-project' || !event.newValue) return;
    var newProject = String(event.newValue).trim();
    var match = Array.from(dropdown.options).find(function (o) { return _nk(o.value) === _nk(newProject); });
    if (match && dropdown.value !== match.value) {
      dropdown.value = match.value;
      dropdown.dispatchEvent(new Event('change'));
    }
  });
})();
