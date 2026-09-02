(function initReferenceEditGroupUtils(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ReferenceEditGroupUtils = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createReferenceEditGroupUtils() {
  'use strict';

  const SENTINEL_DATE = '1900-01-01';
  // Champs qui définissent « la même ligne sur un autre document ». La remarque en
  // est volontairement absente : elle se propage à la sélection sans jamais la
  // restreindre, deux lignes ne cessent pas d'être jumelles parce qu'on a écrit
  // « Officiel » sur l'une et « Conservatoire » sur l'autre.
  const COMPARISON_FIELDS = Object.freeze([
    'Emetteur',
    'Reference',
    'Indice',
    'Recu',
    'DureeLimite',
    'Bloquant',
    'DescriptionObservations',
  ]);
  // Ne plus comparer la remarque pour apparier les lignes ne veut pas dire cesser
  // de la surveiller : entre l'ouverture de la fenêtre et l'enregistrement, une
  // remarque changée ailleurs serait écrasée par la valeur périmée du formulaire.
  const STALENESS_FIELDS = Object.freeze([...COMPARISON_FIELDS, 'Remarque']);

  function normalizeText(value) {
    return String(value ?? '').trim();
  }

  function normalizeIdentityPart(value) {
    return normalizeText(value)
      .replace(/\s+/g, ' ')
      .toLocaleLowerCase('fr');
  }

  function normalizeDate(value) {
    if (value == null || value === '') return '';

    let year;
    let month;
    let day;
    if (value instanceof Date) {
      if (Number.isNaN(value.getTime())) return '';
      year = value.getFullYear();
      month = value.getMonth() + 1;
      day = value.getDate();
    } else if (typeof value === 'number') {
      const timestamp = Math.abs(value) >= 86400 && Math.abs(value) < 1e11
        ? value * 1000
        : value;
      const date = new Date(timestamp);
      if (Number.isNaN(date.getTime())) return '';
      year = date.getFullYear();
      month = date.getMonth() + 1;
      day = date.getDate();
    } else {
      const text = normalizeText(value);
      const isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s].*)?$/);
      const frenchMatch = text.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+.*)?$/);
      if (isoMatch) {
        year = Number(isoMatch[1]);
        month = Number(isoMatch[2]);
        day = Number(isoMatch[3]);
      } else if (frenchMatch) {
        year = Number(frenchMatch[3]);
        month = Number(frenchMatch[2]);
        day = Number(frenchMatch[1]);
      } else {
        const date = new Date(text);
        if (Number.isNaN(date.getTime())) return '';
        year = date.getFullYear();
        month = date.getMonth() + 1;
        day = date.getDate();
      }
    }

    const candidate = new Date(year, month - 1, day);
    if (
      candidate.getFullYear() !== year ||
      candidate.getMonth() !== month - 1 ||
      candidate.getDate() !== day
    ) return '';

    const isoDate = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return isoDate === SENTINEL_DATE ? '' : isoDate;
  }

  function normalizeDuration(value) {
    const text = normalizeText(value);
    if (!text) return '';
    const numericValue = Number(text.replace(',', '.'));
    return Number.isFinite(numericValue) ? String(numericValue) : text;
  }

  // Grist rend un booléen, mais une colonne relue en texte peut arriver en '0',
  // 'false' ou vide : tous valent « non coché ».
  function normalizeBoolean(value) {
    if (typeof value === 'string') {
      const text = normalizeText(value).toLocaleLowerCase('fr');
      return !text || text === '0' || text === 'false' ? '' : '1';
    }
    return value ? '1' : '';
  }

  function getComparableValues(record) {
    return {
      Emetteur: normalizeText(record?.Emetteur),
      Reference: normalizeText(record?.Reference),
      Indice: normalizeText(record?.Indice),
      Recu: normalizeDate(record?.Recu),
      DureeLimite: normalizeDuration(record?.DureeLimite),
      Bloquant: normalizeBoolean(record?.Bloquant),
      DescriptionObservations: normalizeText(record?.DescriptionObservations),
    };
  }

  function normalizeRemarque(value) {
    const text = normalizeText(value);
    return text === 'Conservatoire' || text === 'Officiel' ? text : '';
  }

  function getComparisonKey(record) {
    const comparable = getComparableValues(record);
    return JSON.stringify(COMPARISON_FIELDS.map((field) => comparable[field]));
  }

  function getStalenessKey(record) {
    const values = {
      ...getComparableValues(record),
      Remarque: normalizeRemarque(record?.Remarque),
    };
    return JSON.stringify(STALENESS_FIELDS.map((field) => values[field]));
  }

  function getDocumentIdentityKey(record, {
    projectNormalizer = normalizeIdentityPart,
    serviceNormalizer = normalizeIdentityPart,
  } = {}) {
    return [
      projectNormalizer(record?.NomProjet),
      normalizeIdentityPart(record?.NumeroDocument),
      normalizeIdentityPart(record?.NomDocument),
      normalizeIdentityPart(record?.Type_document),
      normalizeIdentityPart(record?.Zone),
      serviceNormalizer(record?.Service),
    ].join('||');
  }

  function findMatchingOtherRows(sourceRecords, initialRecord, {
    currentRecordId = initialRecord?.id,
    projectValue = initialRecord?.NomProjet,
    serviceValue = initialRecord?.Service,
    projectNormalizer = normalizeIdentityPart,
    serviceNormalizer = normalizeIdentityPart,
  } = {}) {
    if (!initialRecord) return [];
    const initialComparisonKey = getComparisonKey(initialRecord);
    const initialDocumentKey = getDocumentIdentityKey(initialRecord, {
      projectNormalizer,
      serviceNormalizer,
    });
    const projectKey = projectNormalizer(projectValue);
    const serviceKey = serviceNormalizer(serviceValue);

    return (Array.isArray(sourceRecords) ? sourceRecords : []).filter((record) => {
      const recordId = Number(record?.id);
      if (!Number.isInteger(recordId) || recordId <= 0 || recordId === Number(currentRecordId)) {
        return false;
      }
      if (projectNormalizer(record?.NomProjet) !== projectKey) return false;
      if (serviceNormalizer(record?.Service) !== serviceKey) return false;
      if (getDocumentIdentityKey(record, { projectNormalizer, serviceNormalizer }) === initialDocumentKey) {
        return false;
      }
      return getComparisonKey(record) === initialComparisonKey;
    });
  }

  function tableToRows(rawTable) {
    if (!rawTable || typeof rawTable !== 'object') return [];
    const columns = Object.keys(rawTable).filter((key) => Array.isArray(rawTable[key]));
    const rowCount = columns.reduce(
      (maximum, column) => Math.max(maximum, rawTable[column].length),
      0
    );
    return Array.from({ length: rowCount }, (_unused, index) => Object.fromEntries(
      columns.map((column) => [column, rawTable[column][index]])
    ));
  }

  function getTargetRecordIds(currentRecordId, selectedRecordIds = []) {
    return Array.from(new Set([currentRecordId, ...(selectedRecordIds || [])]
      .map(Number)
      .filter((recordId) => Number.isInteger(recordId) && recordId > 0)));
  }

  function buildUpdateActions(updateEntries, tableName = 'References2') {
    return (Array.isArray(updateEntries) ? updateEntries : []).map(({ target, fields }) => [
      'UpdateRecord',
      tableName,
      Number(target.id),
      fields,
    ]);
  }

  function buildRemoveActions(recordIds, tableName = 'References2') {
    return getTargetRecordIds(null, recordIds).map((recordId) => [
      'RemoveRecord',
      tableName,
      recordId,
    ]);
  }

  function findUpdateDuplicateConflict(sourceRecords, updateEntries, {
    getIdentity,
    isArchived = (record) => Boolean(record?.Archive),
  } = {}) {
    if (typeof getIdentity !== 'function') {
      throw new TypeError("La fonction d'identité des doublons est obligatoire.");
    }
    const entries = Array.isArray(updateEntries) ? updateEntries : [];
    const targetIds = new Set(entries.map(({ target }) => Number(target?.id)));
    const proposedByIdentity = new Map();

    for (const entry of entries) {
      const candidate = { ...entry.target, ...entry.fields };
      const identity = getIdentity(candidate);
      if (proposedByIdentity.has(identity)) {
        return {
          type: 'selected-targets',
          target: entry.target,
          conflict: proposedByIdentity.get(identity).target,
        };
      }
      proposedByIdentity.set(identity, entry);
      const existingConflict = (Array.isArray(sourceRecords) ? sourceRecords : []).find((record) =>
        !targetIds.has(Number(record?.id)) &&
        !isArchived(record) &&
        getIdentity(record) === identity
      );
      if (existingConflict) {
        return {
          type: 'existing-record',
          target: entry.target,
          conflict: existingConflict,
        };
      }
    }
    return null;
  }

  function createPerTargetUpdates({
    targets = [],
    sharedFields = {},
    durationWeeks = '',
    planningTable = null,
    buildLimitFields,
    withComputedRetard,
  } = {}) {
    if (typeof buildLimitFields !== 'function' || typeof withComputedRetard !== 'function') {
      throw new TypeError('Les fonctions de calcul DateLimite et Retard sont obligatoires.');
    }

    // Le formulaire décide du caractère bloquant de toutes les cibles à la fois :
    // quand il l'impose, la valeur stockée de chaque ligne n'a plus voix au chapitre.
    const hasSharedBloquant = Object.prototype.hasOwnProperty.call(sharedFields || {}, 'Bloquant');

    return targets.map((target) => {
      const limitFields = buildLimitFields({
        planningTable,
        projectName: target?.NomProjet,
        documentInfo: {
          numero: target?.NumeroDocument,
          name: target?.NomDocument,
          type: target?.Type_document,
          zone: target?.Zone,
          service: target?.Service,
        },
        durationWeeks,
        useZeroWhenEmpty: hasSharedBloquant
          ? Boolean(sharedFields.Bloquant)
          : Boolean(target?.Bloquant),
        service: target?.Service,
      });
      return {
        target,
        fields: withComputedRetard({ ...sharedFields, ...limitFields }),
      };
    });
  }

  return Object.freeze({
    COMPARISON_FIELDS,
    SENTINEL_DATE,
    STALENESS_FIELDS,
    buildRemoveActions,
    buildUpdateActions,
    createPerTargetUpdates,
    findMatchingOtherRows,
    findUpdateDuplicateConflict,
    getComparableValues,
    getComparisonKey,
    getDocumentIdentityKey,
    getStalenessKey,
    getTargetRecordIds,
    normalizeBoolean,
    normalizeDate,
    normalizeDuration,
    normalizeIdentityPart,
    normalizeRemarque,
    normalizeText,
    tableToRows,
  });
});
