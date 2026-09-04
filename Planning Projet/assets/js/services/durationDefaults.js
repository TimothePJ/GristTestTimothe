import {
  buildPlanningDurationUpdateFields,
  subtractWeeksFromIsoDate,
  toPlanningIsoDate,
} from "./gristService.js";

// Remplissage groupé des deux colonnes « Durée » du volet gauche, avec une valeur par
// défaut par type de document. Tout ce module est pur : il reçoit les lignes déjà
// affichées et les lignes Grist brutes correspondantes, et rend un plan d'écriture.
// Aucune lecture Grist, aucun DOM.
//
// Deux sources, deux rôles, à ne jamais confondre :
//   - le « group » produit par buildTimelineDataFromPlanningRows porte les métadonnées
//     d'édition (colonne cible, date d'ancrage, éditabilité) et des valeurs DÉRIVÉES
//     destinées à l'affichage. Son champ `meta` est la ligne NORMALISÉE, en camelCase,
//     dont les dates sont des objets Date recalculés : ce n'est pas la ligne Grist.
//   - la ligne brute, indexée par les vrais noms de colonnes, est la seule source
//     valable pour juger qu'une durée est vide et pour alimenter la cascade de dates.

export const DURATION_DEFAULT_MODES = Object.freeze({
  EMPTY_ONLY: "empty",
  ALL: "all",
});

export const DURATION_SLOTS = Object.freeze({
  DEBUT_FIN: "debutFin",
  FIN_DEMARRAGE: "finDemarrage",
});

const SLOT_FIELDS = Object.freeze({
  [DURATION_SLOTS.DEBUT_FIN]: Object.freeze({
    columnKey: "dureeDebutFinColumnKey",
    leftDateColumnKey: "dureeDebutFinLeftDateColumnKey",
    rightIso: "dureeDebutFinRightIso",
    editable: "dureeDebutFinEditable",
  }),
  [DURATION_SLOTS.FIN_DEMARRAGE]: Object.freeze({
    columnKey: "dureeFinDemarrageColumnKey",
    leftDateColumnKey: "dureeFinDemarrageLeftDateColumnKey",
    rightIso: "dureeFinDemarrageRightIso",
    editable: "dureeFinDemarrageEditable",
  }),
});

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function toText(value) {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value).trim();
  return String(value).trim();
}

// Dans Planning_Projet, une durée non renseignée est stockée soit vide, soit à zéro.
// Le mode « Seulement les vides » doit donc traiter ces deux formes de la même
// manière, afin qu'une valeur par défaut puisse remplacer les zéros de la base.
export function isDurationValueEmpty(rawValue) {
  const text = toText(rawValue);
  if (!text) return true;

  return Number(text.replace(",", ".")) === 0;
}

// Même normalisation que la saisie au clavier dans une cellule de durée : virgule
// décimale acceptée, entier positif ou nul exigé. Une saisie vide vaut « ne rien
// appliquer », surtout pas zéro.
export function normalizeDurationDefaultInput(value) {
  const text = toText(value);
  if (!text) return null;
  const numericValue = Number(text.replace(",", "."));
  if (!Number.isFinite(numericValue) || !Number.isInteger(numericValue) || numericValue < 0) {
    return null;
  }
  return numericValue;
}

// Index des lignes Grist brutes par identifiant : les valeurs stockées, sous leurs
// vrais noms de colonnes. C'est ce que le plan consomme.
export function buildRawPlanningRowsById(planningRows = [], columns = {}) {
  const idCol = columns?.id || "id";
  const byId = new Map();
  (Array.isArray(planningRows) ? planningRows : []).forEach((row) => {
    const rowId = Number(row?.[idCol]);
    if (Number.isInteger(rowId) && rowId > 0) byId.set(rowId, row);
  });
  return byId;
}

function isPlanningRow(group) {
  return Boolean(group) && !group.isZoneHeader && Number.isInteger(Number(group.rowId)) && Number(group.rowId) > 0;
}

function getRawRow(rawRowsById, group) {
  if (!rawRowsById) return null;
  const rowId = Number(group?.rowId);
  if (typeof rawRowsById.get === "function") return rawRowsById.get(rowId) || null;
  return rawRowsById[rowId] || null;
}

// Un créneau n'est applicable que si le type de document lui attribue une colonne ET
// que la ligne possède l'ancre de droite dont la date de gauche se déduit. Les deux
// conditions sont décidées au rendu par resolveDurationEditMeta : on les relit ici
// plutôt que de rejouer l'arbre des types, qui divergerait au premier type ajouté.
export function getSlotDescriptor(group, slot) {
  const fields = SLOT_FIELDS[slot];
  if (!fields || !isPlanningRow(group)) return null;

  const columnKey = toText(group[fields.columnKey]);
  const leftDateColumnKey = toText(group[fields.leftDateColumnKey]);
  const rightIso = toText(group[fields.rightIso]);
  if (!columnKey || !leftDateColumnKey) return null;

  return {
    slot,
    columnKey,
    leftDateColumnKey,
    rightIso,
    editable: Boolean(group[fields.editable]) && ISO_DATE_PATTERN.test(rightIso),
  };
}

// L'ancre de droite du créneau début→fin est la date de gauche du créneau
// fin→démarrage : les deux segments se touchent. Quand le second créneau n'existe pas
// (COFFRAGE non lié au planning), l'ancre reste Diff_coffrage.
function resolveDebutFinAnchorColumnKey(group) {
  const finDemarrage = getSlotDescriptor(group, DURATION_SLOTS.FIN_DEMARRAGE);
  if (finDemarrage?.leftDateColumnKey) return finDemarrage.leftDateColumnKey;

  const debutFin = getSlotDescriptor(group, DURATION_SLOTS.DEBUT_FIN);
  return debutFin?.leftDateColumnKey === "dateLimite" ? "diffCoffrage" : "";
}

export function buildDocumentTypeKey(typeDocLabel) {
  return toText(typeDocLabel).toLocaleUpperCase("fr");
}

// Un type de document par ligne du formulaire, avec de quoi désactiver les champs qui
// n'ont aucun sens pour lui et annoncer combien de lignes il peut réellement toucher.
export function collectDurationDefaultTypes(groups = [], columns = {}, rawRowsById = null) {
  const byKey = new Map();

  (Array.isArray(groups) ? groups : []).forEach((group) => {
    if (!isPlanningRow(group)) return;

    const label = toText(group.typeDocLabel);
    const key = buildDocumentTypeKey(label);
    if (!key) return;

    if (!byKey.has(key)) {
      byKey.set(key, {
        key,
        label,
        rowCount: 0,
        slots: {
          [DURATION_SLOTS.DEBUT_FIN]: { supported: false, editableCount: 0, emptyCount: 0, filledCount: 0 },
          [DURATION_SLOTS.FIN_DEMARRAGE]: { supported: false, editableCount: 0, emptyCount: 0, filledCount: 0 },
        },
      });
    }

    const entry = byKey.get(key);
    entry.rowCount += 1;
    const rawRow = getRawRow(rawRowsById, group);

    Object.values(DURATION_SLOTS).forEach((slot) => {
      const descriptor = getSlotDescriptor(group, slot);
      if (!descriptor) return;
      const stats = entry.slots[slot];
      stats.supported = true;
      if (!descriptor.editable || !rawRow) return;

      const fieldName = toText(columns?.[descriptor.columnKey]);
      if (!fieldName) return;
      stats.editableCount += 1;
      if (isDurationValueEmpty(rawRow[fieldName])) stats.emptyCount += 1;
      else stats.filledCount += 1;
    });
  });

  return [...byKey.values()].sort((left, right) =>
    left.label.localeCompare(right.label, "fr", { sensitivity: "base", numeric: true })
  );
}

// Les colonnes de date sortent de Grist tantôt en secondes, tantôt en texte : les
// comparer telles quelles ferait passer pour un changement une valeur identique.
// La comparaison est choisie par colonne, jamais devinée à partir de la valeur : un
// analyseur de date accepte « 2 » et le lit comme 1970, ce qui rendrait deux durées
// différentes égales et ferait sauter des écritures légitimes.
function buildDateFieldSet(columns = {}) {
  return new Set([
    columns.dateLimite || "Date_limite",
    columns.diffCoffrage || "Diff_coffrage",
    columns.diffArmature || "Diff_armature",
    columns.demarragesTravaux || "Demarrages_travaux",
  ].filter(Boolean));
}

function hasAnyFieldChanged(currentRow, nextFields, dateFields) {
  return Object.entries(nextFields || {}).some(([fieldName, nextValue]) => (
    dateFields.has(fieldName)
      ? toPlanningIsoDate(currentRow?.[fieldName]) !== toPlanningIsoDate(nextValue)
      : toText(currentRow?.[fieldName]) !== toText(nextValue)
  ));
}

// Ordre imposé : le créneau fin→démarrage d'abord. Il déplace l'ancre sur laquelle le
// créneau début→fin calcule sa propre date de gauche ; l'ordre inverse produirait une
// date limite décalée d'exactement la seconde durée.
function buildRowPlan(group, rawRow, columns, settings, dateFields) {
  const rowId = Number(group.rowId);
  const workingRow = { ...rawRow };
  const fields = {};
  const outcome = { applied: 0, skippedNoAnchor: 0, skippedAlreadyFilled: 0, skippedNoChange: 0 };

  const anchorField = toText(columns?.[resolveDebutFinAnchorColumnKey(group)]);
  const orderedSlots = [DURATION_SLOTS.FIN_DEMARRAGE, DURATION_SLOTS.DEBUT_FIN];
  // Renseignée seulement si le créneau fin→démarrage a effectivement bougé.
  let recomputedAnchorIso = "";

  orderedSlots.forEach((slot) => {
    const requestedWeeks = settings?.[slot]?.weeks;
    if (requestedWeeks == null) return;

    const descriptor = getSlotDescriptor(group, slot);
    if (!descriptor) return;

    const durationField = toText(columns?.[descriptor.columnKey]);
    const leftDateField = toText(columns?.[descriptor.leftDateColumnKey]);
    if (!durationField || !leftDateField) return;

    if (!descriptor.editable) {
      outcome.skippedNoAnchor += 1;
      return;
    }

    if (
      settings?.[slot]?.mode === DURATION_DEFAULT_MODES.EMPTY_ONLY &&
      !isDurationValueEmpty(workingRow[durationField])
    ) {
      outcome.skippedAlreadyFilled += 1;
      return;
    }

    const anchorIso = slot === DURATION_SLOTS.DEBUT_FIN && recomputedAnchorIso
      ? recomputedAnchorIso
      : descriptor.rightIso;

    const leftIsoDate = subtractWeeksFromIsoDate(anchorIso, requestedWeeks);
    if (!leftIsoDate) {
      outcome.skippedNoAnchor += 1;
      return;
    }

    // L'ancre affichée peut être DÉRIVÉE et absente de la base : un COFFRAGE de groupe
    // est ancré sur le minimum des ARMATURES de son groupe. La cascade, elle, repart de
    // la valeur stockée. On aligne donc la base sur l'ancre réellement utilisée, sinon
    // la date limite écrite ne serait pas celle annoncée par l'aperçu.
    const alignedFields = {};
    if (
      slot === DURATION_SLOTS.DEBUT_FIN &&
      anchorField &&
      ISO_DATE_PATTERN.test(anchorIso) &&
      toPlanningIsoDate(workingRow[anchorField]) !== anchorIso
    ) {
      alignedFields[anchorField] = anchorIso;
      workingRow[anchorField] = anchorIso;
    }

    const slotFields = {
      ...alignedFields,
      ...buildPlanningDurationUpdateFields(workingRow, columns, {
        durationField,
        durationValue: requestedWeeks,
        leftDateField,
        leftIsoDate,
      }),
    };

    if (!hasAnyFieldChanged(rawRow, { ...fields, ...slotFields }, dateFields)) {
      outcome.skippedNoChange += 1;
      return;
    }

    Object.assign(fields, slotFields);
    Object.assign(workingRow, slotFields);
    if (slot === DURATION_SLOTS.FIN_DEMARRAGE) {
      recomputedAnchorIso = leftIsoDate;
    }
    outcome.applied += 1;
  });

  return { rowId, fields, outcome };
}

// Un plan d'écriture : une entrée par ligne, fusionnant les deux créneaux, prête pour
// syncPlanningDerivedValues. Les clés de `fields` sont des noms de colonnes Grist.
export function buildDurationDefaultPlan({
  groups = [],
  rawRowsById = null,
  columns = {},
  settingsByTypeKey = {},
} = {}) {
  const updates = [];
  const stats = {
    rowsTouched: 0,
    valuesApplied: 0,
    skippedNoAnchor: 0,
    skippedAlreadyFilled: 0,
    skippedNoChange: 0,
    skippedNoRow: 0,
  };

  const dateFields = buildDateFieldSet(columns);

  (Array.isArray(groups) ? groups : []).forEach((group) => {
    if (!isPlanningRow(group)) return;

    const settings = settingsByTypeKey?.[buildDocumentTypeKey(group.typeDocLabel)];
    if (!settings) return;

    // Sans la ligne stockée on ne peut ni juger de la vacuité, ni dérouler la cascade :
    // écrire à l'aveugle serait pire que de s'abstenir.
    const rawRow = getRawRow(rawRowsById, group);
    if (!rawRow) {
      stats.skippedNoRow += 1;
      return;
    }

    const { rowId, fields, outcome } = buildRowPlan(group, rawRow, columns, settings, dateFields);
    stats.skippedNoAnchor += outcome.skippedNoAnchor;
    stats.skippedAlreadyFilled += outcome.skippedAlreadyFilled;
    stats.skippedNoChange += outcome.skippedNoChange;
    if (!outcome.applied || !Object.keys(fields).length) return;

    stats.rowsTouched += 1;
    stats.valuesApplied += outcome.applied;
    updates.push({ id: rowId, fields });
  });

  return { updates, stats };
}

export function describeDurationDefaultStats(stats = {}) {
  const parts = [];
  const rows = Number(stats.rowsTouched) || 0;
  const values = Number(stats.valuesApplied) || 0;

  parts.push(rows
    ? `${values} durée${values > 1 ? "s" : ""} sur ${rows} ligne${rows > 1 ? "s" : ""}`
    : "aucune ligne à modifier");

  const alreadyFilled = Number(stats.skippedAlreadyFilled) || 0;
  if (alreadyFilled) parts.push(`${alreadyFilled} déjà renseignée${alreadyFilled > 1 ? "s" : ""}`);

  const noAnchor = Number(stats.skippedNoAnchor) || 0;
  if (noAnchor) parts.push(`${noAnchor} sans date de référence`);

  const noChange = Number(stats.skippedNoChange) || 0;
  if (noChange) parts.push(`${noChange} déjà à cette valeur`);

  return parts.join(" · ");
}
