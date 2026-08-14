(function initReferenceDocumentFilterUtils(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ReferenceDocumentFilterUtils = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createReferenceDocumentFilterUtils() {
  'use strict';

  // Les listes de documents des dialogues « Ajouter » et « Modifier » se filtrent sur
  // trois axes indépendants : une recherche texte sur le numéro et le nom, un menu
  // Type et un menu Zone. Ce module ne connaît que des entrées neutres, sans DOM :
  // c'est ce qui le rend testable sous node --test.

  const ALL_VALUE = '__ALL__';
  const NO_TYPE_VALUE = '__sans_type__';
  const NO_ZONE_VALUE = '__sans_zone__';
  const DEFAULT_TYPE_ALL_LABEL = 'Tous les types';
  const DEFAULT_ZONE_ALL_LABEL = 'Toutes les zones';
  const COMBINING_MARKS = /[̀-ͯ]/g;

  // Accents retirés et espaces compressés : « PH  N-U » (double espace, tel qu'il
  // existe en base) doit se trouver en tapant « PH N-U », et « Démolition » en tapant
  // « demolition ».
  function normalizeSearchText(value) {
    return String(value ?? '')
      .normalize('NFD')
      .replace(COMBINING_MARKS, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLocaleLowerCase('fr');
  }

  // Le type et la zone ont leurs propres menus : ils sont volontairement absents de
  // la clé de recherche.
  function buildDocumentSearchKey({ numero, name } = {}) {
    return normalizeSearchText(`${numero ?? ''} ${name ?? ''}`);
  }

  // Tous les mots doivent être présents, dans n'importe quel ordre : « N-D 1101 »
  // trouve « 1101 PH N-D » aussi bien que « PH N-D ».
  function matchesDocumentSearch(searchKey, query) {
    const tokens = normalizeSearchText(query).split(' ').filter(Boolean);
    if (!tokens.length) return true;

    const key = normalizeSearchText(searchKey);
    return tokens.every((token) => key.includes(token));
  }

  function isAllValue(value) {
    return value == null || value === '' || value === ALL_VALUE;
  }

  function matchesFacetValue(entryValue, selectedValue) {
    if (isAllValue(selectedValue)) return true;
    return String(entryValue ?? '') === String(selectedValue);
  }

  // Les options d'un menu se calculent sur les entrées qui passent les *autres*
  // filtres : aucune option proposée ne peut donc produire une liste vide.
  function buildFacetOptions(scopedEntries, allEntries, {
    valueKey,
    labelKey,
    allLabel,
    selectedValue,
  }) {
    const optionsByValue = new Map();
    scopedEntries.forEach((entry) => {
      const value = String(entry?.[valueKey] ?? '');
      if (!optionsByValue.has(value)) {
        optionsByValue.set(value, { value, label: String(entry?.[labelKey] ?? value), count: 0 });
      }
      optionsByValue.get(value).count += 1;
    });

    const options = [{ value: ALL_VALUE, label: allLabel, count: scopedEntries.length }];
    optionsByValue.forEach((option) => options.push(option));

    // La valeur choisie a pu disparaître du périmètre : la conserver à zéro évite que
    // le <select> se réinitialise tout seul et masque la raison de la liste vide.
    const selectedKey = String(selectedValue ?? '');
    if (!isAllValue(selectedValue) && !optionsByValue.has(selectedKey)) {
      const knownEntry = allEntries.find((entry) => String(entry?.[valueKey] ?? '') === selectedKey);
      options.push({
        value: selectedKey,
        label: String(knownEntry?.[labelKey] ?? selectedKey),
        count: 0,
      });
    }

    return options;
  }

  function computeDocumentFacets(entries, filters = {}) {
    const allEntries = Array.isArray(entries) ? entries : [];
    const {
      query = '',
      type = ALL_VALUE,
      zone = ALL_VALUE,
      typeAllLabel = DEFAULT_TYPE_ALL_LABEL,
      zoneAllLabel = DEFAULT_ZONE_ALL_LABEL,
    } = filters;

    const matchesQuery = (entry) => matchesDocumentSearch(entry?.searchKey, query);
    const matchesType = (entry) => matchesFacetValue(entry?.typeKey, type);
    const matchesZone = (entry) => matchesFacetValue(entry?.zoneKey, zone);

    const searched = allEntries.filter(matchesQuery);
    const visible = searched.filter((entry) => matchesType(entry) && matchesZone(entry));

    return {
      visibleKeys: new Set(visible.map((entry) => entry.key)),
      visibleCount: visible.length,
      typeOptions: buildFacetOptions(searched.filter(matchesZone), allEntries, {
        valueKey: 'typeKey',
        labelKey: 'typeLabel',
        allLabel: typeAllLabel,
        selectedValue: type,
      }),
      zoneOptions: buildFacetOptions(searched.filter(matchesType), allEntries, {
        valueKey: 'zoneKey',
        labelKey: 'zoneLabel',
        allLabel: zoneAllLabel,
        selectedValue: zone,
      }),
    };
  }

  return Object.freeze({
    ALL_VALUE,
    NO_TYPE_VALUE,
    NO_ZONE_VALUE,
    buildDocumentSearchKey,
    computeDocumentFacets,
    matchesDocumentSearch,
    normalizeSearchText,
  });
});
