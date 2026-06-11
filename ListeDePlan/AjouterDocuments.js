(function () {
  'use strict';

  // ============================================================
  //  CONSTANTES
  // ============================================================
  const DEFAULT_DATE = '1900-01-01';
  const DEFAULT_DOC_TYPE = 'NDC';
  const DEFAULT_DOC_TYPES = ['COFFRAGE', 'ARMATURES', 'COUPES', 'DÉMOLITION', 'NDC'];
  const LISTEPLAN_TABLE_CANDIDATES = ['ListePlan_NDC_COF', 'ListePlan NDC+COF', 'ListePlan_NDC+COF'];
  const PLANNING_TABLE_CANDIDATES = ['Planning_Projet', 'Planning_Project'];

  // ============================================================
  //  ÉTAT
  // ============================================================
  let pendingDocs = [];
  let cachedListePlanTableName = null;
  let cachedPlanningTableName = null;
  let cachedProjectZones = [];
  let cachedProjectForZones = '';
  let cachedEmittersData = null;  // { defaultEmetteurs: [], projectEmetteurs: [] }
  let cachedProjectForEmitters = '';
  let emittersFetchPromise = null; // promesse en vol pour éviter les doublons
  let projetsTableCache = null;

  // ============================================================
  //  CONTEXTE PROJET
  // ============================================================
  function getSelectedProject() {
    return (document.getElementById('projectDropdown')?.value || '').trim();
  }

  // ============================================================
  //  HELPERS TEXTE
  // ============================================================
  function _norm(v) {
    return String(v ?? '').trim();
  }

  function normalizeTypeDocument(v) {
    return String(v ?? '').trim().toLocaleUpperCase('fr');
  }

  function normalizeZoneValue(v) {
    return String(v ?? '').trim();
  }

  function normalizeZoneMatchKey(v) {
    return normalizeZoneValue(v)
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLocaleLowerCase('fr')
      .replace(/[^a-z0-9]/g, '');
  }

  function resolveCanonicalZoneValue(value, sourceZones) {
    const normalized = normalizeZoneValue(value);
    const zoneKey = normalizeZoneMatchKey(normalized);
    if (!zoneKey) return '';
    const match = (sourceZones || [])
      .map((z) => normalizeZoneValue(z))
      .find((z) => normalizeZoneMatchKey(z) === zoneKey);
    return match || normalized;
  }

  function formatZoneLabel(v) {
    const normalized = normalizeZoneValue(v);
    return normalized || 'Sans zone';
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

  function normalizeNumeroRaw(v) {
    if (v == null) return null;
    const s = String(v).trim();
    return (s === '' || s === '-' || s === '_') ? null : s;
  }

  function parseNumeroForStorage(v) {
    return normalizeNumeroRaw(v);
  }

  function numeroOrZero(v) {
    return (v == null ? 0 : v);
  }

  function numeroSortable(v) {
    const s = normalizeNumeroRaw(v);
    if (s == null) return Infinity;
    const n = Number(s);
    return Number.isFinite(n) ? n : Infinity;
  }

  function normalizeNumeroPadding(value) {
    const n = Number.parseInt(value, 10);
    if (!Number.isFinite(n)) return 3;
    return Math.max(3, n);
  }

  // ============================================================
  //  HELPERS TYPES
  // ============================================================
  function isDefaultDocumentType(type) {
    return DEFAULT_DOC_TYPES.includes(normalizeTypeDocument(type));
  }

  function isCoffrageDocumentType(typeDoc) {
    const t = normalizeTypeDocument(typeDoc);
    return t.includes('COFFRAGE') || t.includes('COF');
  }

  function collectPendingDocumentTypes() {
    return pendingDocs.map((doc) => normalizeTypeDocument(doc?.type)).filter(Boolean);
  }

  function populateDocumentTypeSuggestionLists(types) {
    ['lp-manual-type-list', 'lp-pattern-type-list'].forEach((listId) => {
      const datalist = document.getElementById(listId);
      if (!(datalist instanceof HTMLDataListElement)) return;
      datalist.innerHTML = '';
      (types || []).forEach((type) => {
        const option = document.createElement('option');
        option.value = type;
        datalist.appendChild(option);
      });
    });
  }

  async function refreshProjectTypeSuggestionLists(projectName = getSelectedProject()) {
    let table = projetsTableCache;
    if (!table) {
      table = await refreshProjectsTableCache();
    }

    const seen = new Set();
    const types = [];
    [
      ...DEFAULT_DOC_TYPES,
      ...collectProjectCustomDocumentTypes(projectName, table),
      ...collectPendingDocumentTypes(),
    ].forEach((type) => {
      const normalized = normalizeTypeDocument(type);
      if (!normalized || seen.has(normalized)) return;
      seen.add(normalized);
      types.push(normalized);
    });
    if (_norm(projectName) !== _norm(getSelectedProject())) return;
    populateDocumentTypeSuggestionLists(types);
  }

  // ============================================================
  //  ZONES (cache asynchrone chargé à l'ouverture du dialog)
  // ============================================================
  async function fetchAndCacheProjectZones(projectName) {
    if (cachedProjectForZones === projectName && cachedProjectZones.length > 0) {
      return cachedProjectZones;
    }
    try {
      const refs = await grist.docApi.fetchTable('References2');
      const projs = refs.NomProjet || [];
      const zones = refs.Zone || [];
      const p = _norm(projectName);
      const seen = new Map();
      for (let i = 0; i < Math.max(projs.length, zones.length); i++) {
        if (_norm(String(projs[i] ?? '')) !== p) continue;
        const z = normalizeZoneValue(String(zones[i] ?? ''));
        const k = normalizeZoneMatchKey(z);
        if (!k || seen.has(k)) continue;
        seen.set(k, z);
      }
      cachedProjectZones = [...seen.values()].sort((a, b) =>
        a.localeCompare(b, 'fr', { sensitivity: 'base', numeric: true })
      );
      cachedProjectForZones = projectName;
    } catch (_e) {
      cachedProjectZones = [];
    }
    return cachedProjectZones;
  }

  function collectPendingZones() {
    const seen = new Set();
    const zones = [];
    pendingDocs.forEach((doc) => {
      const z = normalizeZoneValue(doc?.zone);
      const k = normalizeZoneMatchKey(z);
      if (!z || seen.has(k)) return;
      seen.add(k);
      zones.push(z);
    });
    return zones.sort((a, b) => a.localeCompare(b, 'fr', { sensitivity: 'base', numeric: true }));
  }

  function resolveDocumentZone(value) {
    return resolveCanonicalZoneValue(value, [...cachedProjectZones, ...collectPendingZones()]);
  }

  function refreshZoneLists() {
    const allZones = [...cachedProjectZones, ...collectPendingZones()];
    const seen = new Set();
    const uniqueZones = [];
    allZones.forEach((z) => {
      const k = normalizeZoneMatchKey(z);
      if (!k || seen.has(k)) return;
      seen.add(k);
      uniqueZones.push(z);
    });
    ['lp-manual-zone-list', 'lp-pattern-zone-list'].forEach((listId) => {
      const datalist = document.getElementById(listId);
      if (!datalist) return;
      datalist.innerHTML = '';
      uniqueZones.forEach((z) => {
        const opt = document.createElement('option');
        opt.value = z;
        datalist.appendChild(opt);
      });
    });
  }

  // ============================================================
  //  HELPERS ALPHABET / PATTERN
  // ============================================================
  function normalizeAlphabetLetter(v, fallback) {
    const t = String(v ?? '').trim().toLocaleUpperCase('fr');
    const m = t.match(/[A-Z]/);
    return m ? m[0] : fallback;
  }

  function getAlphabetRangeValues(startValue, endValue) {
    const startLetter = normalizeAlphabetLetter(startValue, 'A');
    const endLetter = normalizeAlphabetLetter(endValue, 'E');
    const startCode = startLetter.charCodeAt(0);
    const endCode = endLetter.charCodeAt(0);
    if (startCode > endCode) {
      return { error: 'Erreur: "De" doit être inférieur ou égal à "À".', values: [] };
    }
    const values = [];
    for (let c = startCode; c <= endCode; c++) values.push(String.fromCharCode(c));
    return { error: '', values };
  }

  function getPatternNameValues() {
    const alphaEnabled = document.getElementById('lp-pattern-alpha-enabled')?.checked;
    if (alphaEnabled) {
      return getAlphabetRangeValues(
        document.getElementById('lp-pattern-alpha-start')?.value,
        document.getElementById('lp-pattern-alpha-end')?.value
      );
    }
    const start = Number.parseInt(document.getElementById('lp-pattern-start')?.value, 10) || 0;
    const end = Number.parseInt(document.getElementById('lp-pattern-end')?.value, 10) || 0;
    const padding = Number.parseInt(document.getElementById('lp-pattern-padding')?.value, 10) || 0;
    if (start > end) {
      return { error: 'Erreur: "De" doit être inférieur ou égal à "À".', values: [] };
    }
    const values = [];
    for (let i = start; i <= end; i++) {
      values.push(padding > 0 ? String(i).padStart(padding, '0') : String(i));
    }
    return { error: '', values };
  }

  function generatePatternDocs(prefix, suffix, nameValues, numeroStart, numeroStep, numeroPadding, type, zone) {
    const docs = [];
    let currentNumero = numeroStart;
    const effectivePadding = normalizeNumeroPadding(numeroPadding);
    nameValues.forEach((nameValue) => {
      let numero = String(currentNumero);
      if (effectivePadding > 0) numero = numero.padStart(effectivePadding, '0');
      docs.push({
        name: `${prefix}${nameValue}${suffix}`,
        numero,
        type: normalizeTypeDocument(type),
        zone: resolveDocumentZone(zone),
      });
      currentNumero += numeroStep;
    });
    return docs;
  }

  function updatePatternPreview() {
    const prefix = document.getElementById('lp-pattern-prefix')?.value || '';
    const suffix = document.getElementById('lp-pattern-suffix')?.value || '';
    const numeroStart = Number.parseInt(document.getElementById('lp-numero-start')?.value, 10) || 0;
    const numeroStep = Number.parseInt(document.getElementById('lp-numero-step')?.value, 10) || 1;
    const numeroPadding = normalizeNumeroPadding(document.getElementById('lp-numero-padding')?.value);
    const type = normalizeTypeDocument(document.getElementById('lp-pattern-type')?.value || '');
    const zone = normalizeZoneValue(document.getElementById('lp-pattern-zone')?.value || '');
    const previewBody = document.getElementById('lp-pattern-preview-body');
    const patternValues = getPatternNameValues();
    if (!previewBody) return;

    if (patternValues.error) {
      previewBody.innerHTML = `<tr><td colspan="4" style="color:red;">${patternValues.error}</td></tr>`;
      return;
    }

    const docs = generatePatternDocs(
      prefix, suffix, patternValues.values.slice(0, 10),
      numeroStart, numeroStep, numeroPadding, type, zone
    );

    if (!docs.length) {
      previewBody.innerHTML = '<tr><td colspan="4">(Aucun aperçu)</td></tr>';
      return;
    }

    previewBody.innerHTML = docs.map((doc) => (
      `<tr><td>${doc.numero}</td><td>${doc.name}</td><td>${doc.type}</td><td>${formatZoneLabel(doc.zone)}</td></tr>`
    )).join('') + (patternValues.values.length > 10 ? '<tr><td>...</td><td>...</td><td>...</td><td>...</td></tr>' : '');
  }

  // ============================================================
  //  DOCUMENTS EN ATTENTE
  // ============================================================
  function buildDocKey(doc) {
    return [
      _norm(doc.name).toLocaleLowerCase('fr'),
      _norm(doc.numero).toLocaleLowerCase('fr'),
      normalizeTypeDocument(doc.type).toLocaleLowerCase('fr'),
      normalizeZoneMatchKey(doc.zone),
    ].join('||');
  }

  function addPendingDocs(documents) {
    const seen = new Set(pendingDocs.map((doc) => buildDocKey(doc)));
    documents.forEach((doc) => {
      const next = {
        name: _norm(doc?.name || doc?.documentName),
        numero: _norm(doc?.numero || doc?.documentNumber),
        type: normalizeTypeDocument(doc?.type || doc?.documentType || DEFAULT_DOC_TYPE),
        zone: resolveDocumentZone(doc?.zone || doc?.documentZone || ''),
      };
      if (!next.name || !next.numero) return;
      const key = buildDocKey(next);
      if (seen.has(key)) return;
      seen.add(key);
      pendingDocs.push(next);
    });
    renderPendingDocs();
    refreshZoneLists();
    void refreshProjectTypeSuggestionLists();
  }

  function renderPendingDocs() {
    const container = document.getElementById('lp-add-docs-selection-container');
    if (!container) return;

    if (!pendingDocs.length) {
      container.innerHTML = '<p class="lp-empty-state">Aucun document ajouté pour le moment.</p>';
      return;
    }

    const docsWithIndex = pendingDocs.map((doc, index) => ({ ...doc, __index: index }));
    const groupedTypes = new Map();
    docsWithIndex.forEach((doc) => {
      const typeKey = normalizeTypeDocument(doc.type) || DEFAULT_DOC_TYPE;
      if (!groupedTypes.has(typeKey)) groupedTypes.set(typeKey, []);
      groupedTypes.get(typeKey).push(doc);
    });

    const orderedTypes = [];
    const seenTypes = new Set();
    [...DEFAULT_DOC_TYPES, ...Array.from(groupedTypes.keys())].forEach((t) => {
      const n = normalizeTypeDocument(t);
      if (!n || seenTypes.has(n) || !groupedTypes.has(n)) return;
      seenTypes.add(n);
      orderedTypes.push(n);
    });

    container.innerHTML = '';

    orderedTypes.forEach((typeKey) => {
      const typeGroup = document.createElement('section');
      typeGroup.className = 'lp-type-group';

      const typeTitle = document.createElement('h4');
      typeTitle.className = 'lp-type-title';
      typeTitle.textContent = typeKey || 'Sans type';
      typeGroup.appendChild(typeTitle);

      const zoneGroups = new Map();
      groupedTypes.get(typeKey).forEach((doc) => {
        const zoneKey = normalizeZoneMatchKey(doc.zone);
        if (!zoneGroups.has(zoneKey)) {
          zoneGroups.set(zoneKey, { zone: normalizeZoneValue(doc.zone), docs: [] });
        }
        zoneGroups.get(zoneKey).docs.push(doc);
      });

      Array.from(zoneGroups.values())
        .sort((a, b) => compareZoneKeys(a.zone, b.zone))
        .forEach((zoneGroup) => {
          const zoneSection = document.createElement('div');
          zoneSection.className = 'lp-zone-group';

          const zoneTitle = document.createElement('h5');
          zoneTitle.className = 'lp-zone-title';
          zoneTitle.textContent = formatZoneLabel(zoneGroup.zone);
          zoneSection.appendChild(zoneTitle);

          const chipList = document.createElement('div');
          chipList.className = 'lp-chip-list';

          zoneGroup.docs
            .slice()
            .sort((a, b) => {
              const sortA = numeroSortable(parseNumeroForStorage(a.numero));
              const sortB = numeroSortable(parseNumeroForStorage(b.numero));
              if (sortA !== sortB) return sortA - sortB;
              return _norm(a.name).localeCompare(_norm(b.name), 'fr', { sensitivity: 'base', numeric: true });
            })
            .forEach((doc) => {
              const chip = document.createElement('div');
              chip.className = 'lp-doc-chip';

              const numeroSpan = document.createElement('span');
              numeroSpan.className = 'lp-doc-chip-numero';
              numeroSpan.textContent = _norm(doc.numero) || '-';

              const textSpan = document.createElement('span');
              textSpan.className = 'lp-doc-chip-text';
              textSpan.textContent = _norm(doc.name);

              const deleteBtn = document.createElement('button');
              deleteBtn.type = 'button';
              deleteBtn.className = 'lp-doc-chip-delete';
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

    container.querySelectorAll('.lp-doc-chip-delete').forEach((btn) => {
      btn.addEventListener('click', (event) => {
        const index = Number.parseInt(event.currentTarget.dataset.index, 10);
        if (!Number.isFinite(index)) return;
        pendingDocs.splice(index, 1);
        renderPendingDocs();
        refreshZoneLists();
      });
    });
  }

  // ============================================================
  //  BUILDER MODAL (sous-fenêtre)
  // ============================================================
  function setBuilderTab(tabName) {
    const normalized = tabName === 'pattern' ? 'pattern' : 'manual';
    document.querySelectorAll('.lp-tab-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.lpTab === normalized);
    });
    const manualTab = document.getElementById('lp-tab-manual');
    const patternTab = document.getElementById('lp-tab-pattern');
    if (manualTab) manualTab.style.display = normalized === 'manual' ? 'block' : 'none';
    if (patternTab) patternTab.style.display = normalized === 'pattern' ? 'block' : 'none';
    if (normalized === 'pattern') updatePatternPreview();
  }

  function resetBuilderFields() {
    const ids = [
      ['lp-manual-zone', 'value', ''],
      ['lp-manual-type', 'value', ''],
      ['lp-manual-name', 'value', ''],
      ['lp-manual-numero', 'value', ''],
      ['lp-pattern-zone', 'value', ''],
      ['lp-pattern-type', 'value', ''],
      ['lp-pattern-prefix', 'value', ''],
      ['lp-pattern-suffix', 'value', ''],
      ['lp-pattern-start', 'value', '1'],
      ['lp-pattern-end', 'value', '5'],
      ['lp-pattern-padding', 'value', '0'],
      ['lp-pattern-alpha-start', 'value', 'A'],
      ['lp-pattern-alpha-end', 'value', 'E'],
      ['lp-numero-start', 'value', '1'],
      ['lp-numero-step', 'value', '1'],
      ['lp-numero-padding', 'value', '3'],
    ];
    ids.forEach(([id, prop, val]) => {
      const el = document.getElementById(id);
      if (el) el[prop] = val;
    });

    const alphaEnabled = document.getElementById('lp-pattern-alpha-enabled');
    if (alphaEnabled) alphaEnabled.checked = false;

    const numberRange = document.getElementById('lp-pattern-number-range');
    const alphaRange = document.getElementById('lp-pattern-alpha-range');
    if (numberRange) numberRange.hidden = false;
    if (alphaRange) alphaRange.hidden = true;

    setBuilderTab('manual');
    refreshZoneLists();
    updatePatternPreview();
  }

  function openBuilderModal() {
    const modal = document.getElementById('lp-docs-builder-modal');
    if (!modal) return;
    resetBuilderFields();
    void refreshProjectTypeSuggestionLists();
    modal.hidden = false;
  }

  function closeBuilderModal() {
    const modal = document.getElementById('lp-docs-builder-modal');
    if (!modal) return;
    modal.hidden = true;
  }

  // ============================================================
  //  ÉMETTEURS
  // ============================================================
  async function getDefaultEmetteurs() {
    try {
      const t = await grist.docApi.fetchTable('Emetteurs');
      if (t && t.Emetteurs && t.Emetteurs.length > 0) {
        return t.Emetteurs.filter((v) => !!v)
          .sort((a, b) => a.localeCompare(b, 'fr', { sensitivity: 'base' }));
      }
      return [];
    } catch (_e) {
      return [];
    }
  }

  function populateEmetteurDropdown(projectEmetteurs, defaultEmetteurs) {
    const container = document.getElementById('lp-add-docs-emetteur-dropdown');
    if (!container) return;
    container.innerHTML = '';

    const selectAllDiv = document.createElement('div');
    selectAllDiv.className = 'lp-emetteur-item';
    const selectAllCb = document.createElement('input');
    selectAllCb.type = 'checkbox';
    selectAllCb.id = 'lp-emetteur-select-all';
    selectAllCb.dataset.selectAll = 'true';
    const selectAllSpan = document.createElement('span');
    selectAllSpan.textContent = 'Tout sélectionner';
    selectAllDiv.appendChild(selectAllCb);
    selectAllDiv.appendChild(selectAllSpan);
    container.appendChild(selectAllDiv);

    selectAllCb.addEventListener('change', function () {
      container.querySelectorAll("input[type='checkbox']:not(#lp-emetteur-select-all)")
        .forEach((cb) => { cb.checked = selectAllCb.checked; });
    });

    const allEmetteurs = [...defaultEmetteurs, ...projectEmetteurs]
      .filter((v, i, a) => a.indexOf(v) === i)
      .sort((a, b) => a.localeCompare(b, 'fr', { sensitivity: 'base' }));

    allEmetteurs.forEach((emetteur) => {
      const item = document.createElement('div');
      item.className = 'lp-emetteur-item';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.value = emetteur;
      const span = document.createElement('span');
      span.textContent = emetteur;
      item.appendChild(cb);
      item.appendChild(span);
      container.appendChild(item);
    });
  }

  async function fetchEmittersData(projectName) {
    const defaultEmetteurs = await getDefaultEmetteurs();
    let projectEmetteurs = [];
    try {
      const refs = await grist.docApi.fetchTable('References2');
      const projs = refs.NomProjet || [];
      const emetteurs = refs.Emetteur || [];
      const p = _norm(projectName);
      const seen = new Set();
      for (let i = 0; i < Math.max(projs.length, emetteurs.length); i++) {
        if (_norm(String(projs[i] ?? '')) !== p) continue;
        const e = String(emetteurs[i] ?? '').trim();
        if (!e || seen.has(e)) continue;
        seen.add(e);
        projectEmetteurs.push(e);
      }
      projectEmetteurs.sort((a, b) => a.localeCompare(b, 'fr', { sensitivity: 'base' }));
    } catch (_e) {
      projectEmetteurs = [];
    }
    return { defaultEmetteurs, projectEmetteurs };
  }

  function prefetchForProject(projectName) {
    if (!projectName) return;
    fetchAndCacheProjectZones(projectName).catch(() => {});
    refreshProjectsTableCache()
      .then(() => refreshProjectTypeSuggestionLists(projectName))
      .catch(() => {});
    if (cachedProjectForEmitters !== projectName) {
      cachedProjectForEmitters = projectName;
      cachedEmittersData = null;
      emittersFetchPromise = fetchEmittersData(projectName).then((data) => {
        if (cachedProjectForEmitters === projectName) {
          cachedEmittersData = data;
        }
        return data;
      }).catch(() => null);
    }
  }

  async function populateEmetteurDropdownForDialog() {
    const selectedProject = getSelectedProject();
    if (!selectedProject) return;

    // Cache chaud → instantané
    if (cachedProjectForEmitters === selectedProject && cachedEmittersData) {
      populateEmetteurDropdown(cachedEmittersData.projectEmetteurs, cachedEmittersData.defaultEmetteurs);
      return;
    }

    // Fetch en vol → on attend la même promesse, pas de doublon
    if (cachedProjectForEmitters === selectedProject && emittersFetchPromise) {
      const data = await emittersFetchPromise;
      if (data) populateEmetteurDropdown(data.projectEmetteurs, data.defaultEmetteurs);
      return;
    }

    // Fallback : lancer un nouveau fetch
    const data = await fetchEmittersData(selectedProject);
    if (data) {
      cachedEmittersData = data;
      cachedProjectForEmitters = selectedProject;
      populateEmetteurDropdown(data.projectEmetteurs, data.defaultEmetteurs);
    }
  }

  function collectSelectedEmitters() {
    return Array.from(
      document.querySelectorAll('#lp-add-docs-emetteur-dropdown input[type="checkbox"]:checked')
    )
      .filter((cb) => cb.dataset.selectAll !== 'true' && cb.id !== 'lp-emetteur-select-all')
      .map((cb) => cb.value)
      .filter(Boolean);
  }

  // ============================================================
  //  DIALOG OUVERTURE / FERMETURE
  // ============================================================
  function _resetDialogState() {
    pendingDocs = [];
    closeBuilderModal();
    renderPendingDocs();
    const dateInput = document.getElementById('lp-add-docs-default-date');
    if (dateInput) dateInput.value = '';
    resetBuilderFields();
  }

  function openDialog() {
    const project = getSelectedProject();
    if (!project) {
      alert("Veuillez sélectionner un projet avant d'ajouter des documents.");
      return;
    }
    // Ouverture immédiate — le reset a déjà eu lieu à la fermeture précédente
    const dialog = document.getElementById('lp-add-docs-dialog');
    if (dialog && typeof dialog.showModal === 'function') dialog.showModal();
    // Chargement async en fond (souvent déjà en cache grâce au pré-fetch)
    Promise.all([
      fetchAndCacheProjectZones(project).then(() => refreshZoneLists()).catch(() => {}),
      populateEmetteurDropdownForDialog().catch(() => {}),
      refreshProjectsTableCache()
        .then(() => refreshProjectTypeSuggestionLists(project))
        .catch(() => {}),
    ]);
  }

  function closeDialog() {
    const dialog = document.getElementById('lp-add-docs-dialog');
    if (dialog && typeof dialog.close === 'function') dialog.close();
    // Reset après fermeture (pas time-critical) → dialog propre pour la prochaine ouverture
    _resetDialogState();
  }

  // ============================================================
  //  GRIST - RÉSOLUTION NOMS DE TABLES
  // ============================================================
  async function resolveListePlanTableName() {
    if (cachedListePlanTableName) return cachedListePlanTableName;
    for (const name of LISTEPLAN_TABLE_CANDIDATES) {
      try {
        await grist.docApi.fetchTable(name);
        cachedListePlanTableName = name;
        return name;
      } catch (_e) { /* essayer le suivant */ }
    }
    throw new Error("Table ListePlan introuvable (attendu: 'ListePlan_NDC_COF' ou variante).");
  }

  async function resolvePlanningTableName() {
    if (cachedPlanningTableName) return cachedPlanningTableName;
    for (const name of PLANNING_TABLE_CANDIDATES) {
      try {
        await grist.docApi.fetchTable(name);
        cachedPlanningTableName = name;
        return name;
      } catch (_e) { /* essayer le suivant */ }
    }
    throw new Error("Table Planning introuvable (attendu: 'Planning_Projet' ou 'Planning_Project').");
  }

  // ============================================================
  //  GRIST - HELPERS PLANNING
  // ============================================================
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

  function findListePlanIndex(plansTable, projectName, numeroDocStr, typeDocStr, zoneStr) {
    const projs = plansTable.Nom_projet || [];
    const nums = plansTable.NumeroDocument || [];
    const types = plansTable.Type_document || [];
    const zones = plansTable.Zone || [];
    const p = _norm(projectName);
    const n = _norm(numeroDocStr);
    const t = _norm(typeDocStr);
    const z = normalizeZoneMatchKey(zoneStr);
    for (let i = 0; i < Math.max(projs.length, nums.length, types.length, zones.length); i++) {
      if (
        _norm(projs[i]) === p &&
        _norm(nums[i]) === n &&
        _norm(types[i]) === t &&
        normalizeZoneMatchKey(zones[i]) === z
      ) return i;
    }
    return -1;
  }

  function planningZoneExists(planningTable, projectName, zoneStr) {
    const normalizedZone = normalizeZoneValue(zoneStr);
    const normalizedZoneKey = normalizeZoneMatchKey(normalizedZone);
    if (!normalizedZone) return true;
    const projectCol = getPlanningProjectColumn(planningTable);
    const projs = planningTable?.[projectCol] || [];
    const zones = planningTable?.Zone || [];
    const p = _norm(projectName);
    for (let i = 0; i < Math.max(projs.length, zones.length); i++) {
      if (_norm(projs[i]) === p && normalizeZoneMatchKey(zones[i]) === normalizedZoneKey) return true;
    }
    return false;
  }

  function buildPlanningZoneAnchorFields(planningTable, projectName, zoneStr) {
    const projectCol = getPlanningProjectColumn(planningTable);
    const taskCol = getPlanningTaskColumn(planningTable);
    const normalizedZone = normalizeZoneValue(zoneStr);
    const fields = {};
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
    return fields;
  }

  function buildPlanningZoneAnchorActionIfMissing(planningTableName, planningTable, projectName, zoneStr) {
    const normalizedZone = normalizeZoneValue(zoneStr);
    if (!normalizedZone) return null;
    if (planningZoneExists(planningTable, projectName, normalizedZone)) return null;
    return ['AddRecord', planningTableName, null, buildPlanningZoneAnchorFields(planningTable, projectName, normalizedZone)];
  }

  function getPlanningPendingGroupSet(planningTable, projectName) {
    if (!planningTable.__lpPendingGroups) {
      Object.defineProperty(planningTable, '__lpPendingGroups', {
        value: new Map(),
        writable: false,
        enumerable: false,
        configurable: true,
      });
    }
    const map = planningTable.__lpPendingGroups;
    const p = _norm(projectName).toLocaleLowerCase('fr');
    if (!map.has(p)) {
      const projectCol = getPlanningProjectColumn(planningTable);
      const projs = planningTable?.[projectCol] || [];
      const groups = planningTable?.Groupe || [];
      const usedGroups = new Set();
      for (let i = 0; i < Math.max(projs.length, groups.length); i++) {
        if (_norm(projs[i]).toLocaleLowerCase('fr') !== p) continue;
        const g = _norm(groups[i]);
        if (g) usedGroups.add(g.toLocaleLowerCase('fr'));
      }
      map.set(p, usedGroups);
    }
    return map.get(p);
  }

  function getNextAvailablePlanningGroupNumber(planningTable, projectName) {
    const usedGroups = getPlanningPendingGroupSet(planningTable, projectName);
    let nextGroupNumber = 1;
    while (usedGroups.has(String(nextGroupNumber).toLocaleLowerCase('fr'))) {
      nextGroupNumber++;
    }
    const candidate = String(nextGroupNumber);
    usedGroups.add(candidate.toLocaleLowerCase('fr'));
    return candidate;
  }

  function getDefaultPlanningGroupForType(typeDoc, planningTable, projectName) {
    return isCoffrageDocumentType(typeDoc)
      ? getNextAvailablePlanningGroupNumber(planningTable, projectName)
      : '';
  }

  function buildPlanningDocumentUpdateFields(planningTable, { taskName, typeDoc, zoneStr }) {
    const taskCol = getPlanningTaskColumn(planningTable);
    const fields = {};
    setPlanningFieldIfPresent(planningTable, fields, taskCol, String(taskName ?? '').trim());
    setPlanningFieldIfPresent(planningTable, fields, 'Type_doc', String(typeDoc ?? '').trim());
    setPlanningFieldIfPresent(planningTable, fields, 'Zone', normalizeZoneValue(zoneStr));
    return fields;
  }

  function buildPlanningDocumentAddFields(planningTable, { projectName, numeroDocStr, taskName, typeDoc, zoneStr }) {
    const projectCol = getPlanningProjectColumn(planningTable);
    const taskCol = getPlanningTaskColumn(planningTable);
    const fields = {};
    setPlanningFieldIfPresent(planningTable, fields, projectCol, _norm(projectName));
    setPlanningFieldIfPresent(planningTable, fields, 'ID2', _norm(numeroDocStr));
    setPlanningFieldIfPresent(planningTable, fields, taskCol, String(taskName ?? '').trim());
    setPlanningFieldIfPresent(planningTable, fields, 'Type_doc', String(typeDoc ?? '').trim());
    setPlanningFieldIfPresent(planningTable, fields, 'Indice', '');
    setPlanningFieldIfPresent(
      planningTable, fields, 'Groupe',
      getDefaultPlanningGroupForType(typeDoc, planningTable, projectName)
    );
    setPlanningFieldIfPresent(planningTable, fields, 'Zone', normalizeZoneValue(zoneStr));
    return fields;
  }

  function findPlanningIndex(planningTable, projectName, numeroDocStr, typeDocStr, zoneStr, taskName) {
    const projectCol = getPlanningProjectColumn(planningTable);
    const taskCol = getPlanningTaskColumn(planningTable);
    const projs = planningTable?.[projectCol] || [];
    const ids2 = planningTable?.ID2 || [];
    const types = planningTable?.Type_doc || [];
    const zones = planningTable?.Zone || [];
    const tasks = planningTable?.[taskCol] || [];
    const p = _norm(projectName);
    const n = _norm(numeroDocStr);
    const t = _norm(typeDocStr);
    const z = normalizeZoneMatchKey(zoneStr);
    const hasZoneColumn = hasPlanningColumn(planningTable, 'Zone');
    let legacyFallbackIndex = -1;

    for (let i = 0; i < Math.max(projs.length, ids2.length, types.length, zones.length, tasks.length); i++) {
      if (_norm(projs[i]) !== p) continue;
      if (_norm(ids2[i]) !== n) continue;
      if (_norm(types[i]) !== t) continue;
      const currentZone = hasZoneColumn ? normalizeZoneMatchKey(zones[i]) : '';
      if (currentZone === z) return i;
      if (z && currentZone === '') {
        if (_norm(taskName) && _norm(tasks[i]) === _norm(taskName)) return i;
        if (legacyFallbackIndex < 0) legacyFallbackIndex = i;
      }
    }
    return legacyFallbackIndex;
  }

  // ============================================================
  //  GRIST - HELPERS TYPES/PROJETS
  // ============================================================
  async function refreshProjectsTableCache() {
    try {
      projetsTableCache = await grist.docApi.fetchTable('Projets2');
    } catch (_e) {
      projetsTableCache = null;
    }
    return projetsTableCache;
  }

  function getMatchingProjectRowIndexes(projectName, table) {
    if (!table) return [];
    const project = _norm(projectName);
    if (!project) return [];
    const names = Array.isArray(table.Nom_de_projet) ? table.Nom_de_projet : [];
    return names.reduce((acc, val, i) => {
      if (_norm(val) === project) acc.push(i);
      return acc;
    }, []);
  }

  function parseProjectTypeDocValue(value) {
    const seen = new Set();
    return String(value ?? '').split(/[;,\r\n]+/)
      .map((e) => normalizeTypeDocument(e))
      .filter((e) => {
        if (!e || isDefaultDocumentType(e) || seen.has(e)) return false;
        seen.add(e);
        return true;
      });
  }

  function serializeProjectTypeDocValue(types) {
    const seen = new Set();
    return (types || [])
      .map((t) => normalizeTypeDocument(t))
      .filter((t) => {
        if (!t || isDefaultDocumentType(t) || seen.has(t)) return false;
        seen.add(t);
        return true;
      })
      .join('; ');
  }

  function collectProjectCustomDocumentTypes(projectName, table) {
    const typeDocs = Array.isArray(table?.TypeDoc) ? table.TypeDoc : [];
    const seen = new Set();
    const customTypes = [];
    getMatchingProjectRowIndexes(projectName, table).forEach((index) => {
      parseProjectTypeDocValue(typeDocs[index]).forEach((type) => {
        if (seen.has(type)) return;
        seen.add(type);
        customTypes.push(type);
      });
    });
    return customTypes;
  }

  async function buildProjectTypeDocUpdateActions(projectName, types) {
    const project = _norm(projectName);
    if (!project) return [];

    let projetsTable;
    try {
      projetsTable = await refreshProjectsTableCache();
    } catch (_e) {
      return [];
    }

    if (!projetsTable || !Object.prototype.hasOwnProperty.call(projetsTable, 'TypeDoc')) return [];

    const rowIndexes = getMatchingProjectRowIndexes(project, projetsTable);
    if (!rowIndexes.length) return [];

    const existingCustomTypes = collectProjectCustomDocumentTypes(project, projetsTable);
    const mergedTypeDocValue = serializeProjectTypeDocValue([...existingCustomTypes, ...(types || [])]);
    const currentTypeDocValue = serializeProjectTypeDocValue(existingCustomTypes);

    if (mergedTypeDocValue === currentTypeDocValue) return [];

    const ids = Array.isArray(projetsTable.id) ? projetsTable.id : [];
    return rowIndexes.map((i) => ['UpdateRecord', 'Projets2', ids[i], { TypeDoc: mergedTypeDocValue }]);
  }

  async function getTeamService() {
    try {
      const t = await grist.docApi.fetchTable('Team');
      if (Array.isArray(t) && t.length > 0) return t[0].Service || '';
      if (t?.Service && Array.isArray(t.Service)) return t.Service[0] || '';
      return '';
    } catch (_e) {
      return '';
    }
  }

  // ============================================================
  //  GRIST - CRÉATION DES DOCUMENTS (BATCH)
  // ============================================================
  async function createDocumentsBatch(projectName, documents, selectedEmitters, defaultDatelimite) {
    const normalizedProject = _norm(projectName);
    if (!normalizedProject) throw new Error('Aucun projet sélectionné.');

    const normalizedEmitters = (selectedEmitters || []).map((v) => _norm(v)).filter(Boolean);
    if (!normalizedEmitters.length) throw new Error('Veuillez sélectionner au moins un émetteur.');

    const uniqueDocuments = [];
    const seenDocuments = new Set();
    (documents || []).forEach((doc) => {
      const normalizedDoc = {
        documentNumber: _norm(doc?.documentNumber ?? doc?.numero),
        documentName: _norm(doc?.documentName ?? doc?.name),
        documentType: normalizeTypeDocument(doc?.documentType ?? doc?.type ?? DEFAULT_DOC_TYPE),
        documentZone: resolveDocumentZone(doc?.documentZone ?? doc?.zone ?? ''),
      };
      if (!normalizedDoc.documentNumber || !normalizedDoc.documentName || !normalizedDoc.documentType) return;
      const key = [
        normalizedDoc.documentNumber.toLocaleLowerCase('fr'),
        normalizedDoc.documentName.toLocaleLowerCase('fr'),
        normalizedDoc.documentType.toLocaleLowerCase('fr'),
        normalizeZoneMatchKey(normalizedDoc.documentZone),
      ].join('||');
      if (seenDocuments.has(key)) return;
      seenDocuments.add(key);
      uniqueDocuments.push(normalizedDoc);
    });

    if (!uniqueDocuments.length) throw new Error('Veuillez ajouter au moins un document complet.');
    if (typeof window.assertDocumentNumbersAvailable !== 'function') {
      throw new Error("Le controle d'unicite des numeros de document est indisponible.");
    }
    await window.assertDocumentNumbersAvailable(
      normalizedProject,
      (documents || []).map((doc) => _norm(doc?.documentNumber ?? doc?.numero)).filter(Boolean)
    );

    const safeDefaultDate = _norm(defaultDatelimite) || DEFAULT_DATE;
    const serviceValue = await getTeamService();
    const actions = [];

    // --- ListePlan ---
    try {
      const plansTableName = await resolveListePlanTableName();
      const plans = await grist.docApi.fetchTable(plansTableName);
      const pendingPlanAdds = new Set();

      uniqueDocuments.forEach((doc) => {
        const key = [
          normalizedProject.toLocaleLowerCase('fr'),
          doc.documentNumber.toLocaleLowerCase('fr'),
          doc.documentType.toLocaleLowerCase('fr'),
          normalizeZoneMatchKey(doc.documentZone),
        ].join('||');

        if (!pendingPlanAdds.has(key)) {
          actions.push(['AddRecord', plansTableName, null, {
            Nom_projet: normalizedProject,
            NumeroDocument: doc.documentNumber,
            Type_document: doc.documentType,
            Zone: doc.documentZone,
            Designation: doc.documentName,
          }]);
          pendingPlanAdds.add(key);
        }
      });
    } catch (error) {
      console.warn('ListePlan: impossible d\'ajouter / mettre à jour les documents.', error);
    }

    // --- Planning ---
    try {
      const planningTableName = await resolvePlanningTableName();
      const planning = await grist.docApi.fetchTable(planningTableName);
      const queuedZoneAnchors = new Set();
      const pendingPlanningAdds = new Set();

      uniqueDocuments.forEach((doc) => {
        const zoneKey = normalizeZoneMatchKey(doc.documentZone);
        if (zoneKey && !queuedZoneAnchors.has(zoneKey)) {
          const anchorAction = buildPlanningZoneAnchorActionIfMissing(planningTableName, planning, normalizedProject, doc.documentZone);
          if (anchorAction) actions.push(anchorAction);
          queuedZoneAnchors.add(zoneKey);
        }

        const idxPlanning = findPlanningIndex(planning, normalizedProject, doc.documentNumber, doc.documentType, doc.documentZone, doc.documentName);
        const planningKey = [
          normalizedProject.toLocaleLowerCase('fr'),
          doc.documentNumber.toLocaleLowerCase('fr'),
          doc.documentType.toLocaleLowerCase('fr'),
          normalizeZoneMatchKey(doc.documentZone),
        ].join('||');

        if (idxPlanning >= 0) {
          actions.push(['UpdateRecord', planningTableName, planning.id[idxPlanning],
            buildPlanningDocumentUpdateFields(planning, {
              taskName: doc.documentName,
              typeDoc: doc.documentType,
              zoneStr: doc.documentZone,
            })
          ]);
        } else if (!pendingPlanningAdds.has(planningKey)) {
          actions.push(['AddRecord', planningTableName, null,
            buildPlanningDocumentAddFields(planning, {
              projectName: normalizedProject,
              numeroDocStr: doc.documentNumber,
              taskName: doc.documentName,
              typeDoc: doc.documentType,
              zoneStr: doc.documentZone,
            })
          ]);
          pendingPlanningAdds.add(planningKey);
        }
      });
    } catch (error) {
      console.warn('Planning: impossible d\'ajouter / mettre à jour les documents.', error);
    }

    // --- References ---
    uniqueDocuments.forEach((doc) => {
      normalizedEmitters.forEach((emetteur) => {
        actions.push(['AddRecord', 'References2', null, {
          NomProjet: normalizedProject,
          NomDocument: doc.documentName,
          NumeroDocument: doc.documentNumber,
          Type_document: doc.documentType,
          Zone: doc.documentZone,
          Emetteur: emetteur,
          Reference: '_',
          Indice: '-',
          Recu: DEFAULT_DATE,
          DescriptionObservations: 'EN ATTENTE',
          DateLimite: safeDefaultDate,
          Service: serviceValue,
        }]);
      });
    });

    // --- Mise à jour TypeDoc dans Projets ---
    const typeDocActions = await buildProjectTypeDocUpdateActions(
      normalizedProject,
      uniqueDocuments.map((doc) => doc.documentType)
    );
    typeDocActions.forEach((action) => actions.unshift(action));

    await grist.docApi.applyUserActions(actions);
  }

  // ============================================================
  //  CONFIRMATION
  // ============================================================
  async function confirmAddDocs() {
    const confirmBtn = document.getElementById('lp-confirm-add-docs-btn');
    if (confirmBtn) confirmBtn.disabled = true;

    try {
      await createDocumentsBatch(
        getSelectedProject(),
        pendingDocs,
        collectSelectedEmitters(),
        document.getElementById('lp-add-docs-default-date')?.value || DEFAULT_DATE
      );
      closeDialog();
    } catch (error) {
      console.error("Erreur lors de l'ajout des documents :", error);
      alert(error?.message || "Une erreur s'est produite lors de l'ajout des documents.");
    } finally {
      if (confirmBtn) confirmBtn.disabled = false;
    }
  }

  // ============================================================
  //  SETUP LISTENERS INTERNES DU DIALOG
  // ============================================================
  function setupDialogUi() {
    if (window.__lpAddDocsSetup) return;
    window.__lpAddDocsSetup = true;

    // Bouton ouvrir builder
    document.getElementById('lp-open-builder-btn')?.addEventListener('click', openBuilderModal);

    ['lp-manual-type', 'lp-pattern-type'].forEach((id) => {
      const input = document.getElementById(id);
      if (!(input instanceof HTMLInputElement)) return;
      input.addEventListener('click', () => {
        try {
          input.showPicker?.();
        } catch (_error) {
          // Le navigateur affichera naturellement la datalist.
        }
      });
      ['change', 'blur'].forEach((eventName) => {
        input.addEventListener(eventName, () => {
          input.value = normalizeTypeDocument(input.value);
          if (id === 'lp-pattern-type') updatePatternPreview();
        });
      });
    });

    // Bouton fermer builder
    document.getElementById('lp-close-builder-btn')?.addEventListener('click', closeBuilderModal);

    // Onglets
    document.querySelectorAll('.lp-tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => setBuilderTab(btn.dataset.lpTab));
    });

    // Alpha toggle
    document.getElementById('lp-pattern-alpha-enabled')?.addEventListener('change', () => {
      const alphaEnabled = document.getElementById('lp-pattern-alpha-enabled')?.checked;
      const numberRange = document.getElementById('lp-pattern-number-range');
      const alphaRange = document.getElementById('lp-pattern-alpha-range');
      if (numberRange) numberRange.hidden = alphaEnabled;
      if (alphaRange) alphaRange.hidden = !alphaEnabled;
      updatePatternPreview();
    });

    // Preview en temps réel (tab motif)
    [
      'lp-pattern-prefix', 'lp-pattern-suffix', 'lp-pattern-start', 'lp-pattern-end',
      'lp-pattern-padding', 'lp-pattern-alpha-start', 'lp-pattern-alpha-end',
      'lp-numero-start', 'lp-numero-step', 'lp-numero-padding', 'lp-pattern-type',
      'lp-pattern-zone',
    ].forEach((id) => {
      document.getElementById(id)?.addEventListener('input', updatePatternPreview);
      document.getElementById(id)?.addEventListener('change', updatePatternPreview);
    });

    // Bouton "Ajouter" onglet Manuel
    document.getElementById('lp-add-manual-btn')?.addEventListener('click', () => {
      const manualNameInput = document.getElementById('lp-manual-name');
      const manualNumeroInput = document.getElementById('lp-manual-numero');
      const manualTypeInput = document.getElementById('lp-manual-type');
      const manualZoneInput = document.getElementById('lp-manual-zone');

      const docNames = (manualNameInput?.value || '').split(',').map((v) => v.trim()).filter(Boolean);
      const docNumeros = (manualNumeroInput?.value || '').split(',').map((v) => v.trim());
      const documentType = normalizeTypeDocument(manualTypeInput?.value);
      const documentZone = resolveDocumentZone(manualZoneInput?.value || '');

      if (!docNames.length) {
        alert('Veuillez renseigner un nom de document.');
        manualNameInput?.focus();
        return;
      }
      if (!documentType) {
        alert('Veuillez renseigner un type de document.');
        manualTypeInput?.focus();
        return;
      }
      if (!docNumeros[0]) {
        alert('Veuillez renseigner un numéro de document.');
        manualNumeroInput?.focus();
        return;
      }

      const docs = docNames.map((name, index) => ({
        name,
        numero: _norm(docNumeros[index]),
        type: documentType,
        zone: documentZone,
      }));

      addPendingDocs(docs);
      closeBuilderModal();
    });

    // Bouton "Ajouter les documents" onglet Motif
    document.getElementById('lp-add-pattern-btn')?.addEventListener('click', () => {
      const prefix = document.getElementById('lp-pattern-prefix')?.value || '';
      const suffix = document.getElementById('lp-pattern-suffix')?.value || '';
      const patternValues = getPatternNameValues();
      const numeroStart = Number.parseInt(document.getElementById('lp-numero-start')?.value, 10) || 0;
      const numeroStep = Number.parseInt(document.getElementById('lp-numero-step')?.value, 10) || 1;
      const numeroPadding = normalizeNumeroPadding(document.getElementById('lp-numero-padding')?.value);
      const documentType = normalizeTypeDocument(document.getElementById('lp-pattern-type')?.value);
      const documentZone = resolveDocumentZone(document.getElementById('lp-pattern-zone')?.value || '');

      if (!documentType) {
        alert('Veuillez renseigner un type de document.');
        document.getElementById('lp-pattern-type')?.focus();
        return;
      }
      if (patternValues.error) {
        alert(patternValues.error);
        return;
      }
      if (!patternValues.values.length) {
        alert('La plage de valeurs est vide.');
        return;
      }

      addPendingDocs(
        generatePatternDocs(prefix, suffix, patternValues.values, numeroStart, numeroStep, numeroPadding, documentType, documentZone)
      );
      closeBuilderModal();
    });

    // Bouton Confirmer
    document.getElementById('lp-confirm-add-docs-btn')?.addEventListener('click', confirmAddDocs);

    // Bouton Annuler
    document.getElementById('lp-cancel-add-docs-btn')?.addEventListener('click', closeDialog);
  }

  // ============================================================
  //  INIT
  // ============================================================
  function init() {
    // Reset initial : dialog propre dès la première ouverture
    _resetDialogState();

    const btn = document.getElementById('btn-ajouter-docs');
    if (btn) {
      // pointerdown déclenche le pré-fetch ~100ms avant le click → données prêtes à l'ouverture
      btn.addEventListener('pointerdown', () => { prefetchForProject(getSelectedProject()); });
      btn.addEventListener('click', openDialog);
    }

    setupDialogUi();

    // Pré-charger dès qu'un projet est sélectionné dans la liste déroulante
    const projectDropdown = document.getElementById('projectDropdown');
    if (projectDropdown) {
      projectDropdown.addEventListener('change', () => { prefetchForProject(getSelectedProject()); });
      const initial = getSelectedProject();
      if (initial) prefetchForProject(initial);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
