const SELECTORS = {
  projectDropdown: 'projectDropdown',
  chartCanvas: 'avancementChart',
  chartContainer: '.chart-container',
  averageIndicesContainer: 'average-indices-container',
  statsOutput: 'stats-output',
  ruleTypeSelect: 'customRuleTypeSelect',
  ruleIndiceSelect: 'customRuleIndiceSelect',
  addRuleButton: 'addCustomRuleButton',
  ruleFeedback: 'customRuleFeedback',
};

const TABLES = {
  projects: 'Projets',
  ventilation: 'Ventilation',
};

const PROJECT_COLUMNS = {
  id: 'id',
  name: 'Nom_de_projet',
  avancement: 'Avancement',
};

const DOCUMENT_TYPES = {
  unspecified: 'Non specifie',
  total: 'Total',
};

const INDICES = {
  advanced: '0',
};

const state = {
  records: [],
  chart: null,
  currentProjectConfig: null,
  ruleFeedback: null,
  lastSelectedProject: '',
};

const elements = {
  projectDropdown: document.getElementById(SELECTORS.projectDropdown),
  chartCanvas: document.getElementById(SELECTORS.chartCanvas),
  chartContainer: document.querySelector(SELECTORS.chartContainer),
  averageIndicesContainer: document.getElementById(SELECTORS.averageIndicesContainer),
  statsOutput: document.getElementById(SELECTORS.statsOutput),
};

init();

function init() {
  grist.ready({ requiredAccess: 'full' });
  Chart.register(ChartDataLabels);

  elements.projectDropdown.addEventListener('change', () => {
    state.ruleFeedback = null;
    updateDashboard();
  });

  grist.onRecords((newRecords) => {
    state.records = newRecords || [];
    populateProjectDropdown();
    updateDashboard();
  });
}

function populateProjectDropdown() {
  const projects = getProjectNames(state.records);
  const currentValue = elements.projectDropdown.value;

  clearProjectOptions();
  addProjectOptions(projects);
  restoreSelectedProject(currentValue, projects);
}

function getProjectNames(records) {
  return [...new Set(records.map(getRecordProjectName))]
    .filter(Boolean)
    .sort(compareText);
}

function clearProjectOptions() {
  while (elements.projectDropdown.options.length > 1) {
    elements.projectDropdown.remove(1);
  }
}

function addProjectOptions(projects) {
  projects.forEach((project) => {
    const option = document.createElement('option');
    option.value = project;
    option.textContent = project;
    elements.projectDropdown.appendChild(option);
  });
}

function restoreSelectedProject(currentValue, projects) {
  elements.projectDropdown.value = projects.includes(currentValue) ? currentValue : '';
}

async function updateDashboard() {
  const selectedProject = elements.projectDropdown.value;
  clearOutput();

  if (selectedProject !== state.lastSelectedProject) {
    state.ruleFeedback = null;
    state.lastSelectedProject = selectedProject;
  }

  if (!selectedProject) {
    state.currentProjectConfig = null;
    showEmptyState('Veuillez selectionner un projet.');
    return;
  }

  const projectRecords = getProjectRecords(selectedProject);
  if (projectRecords.length === 0) {
    state.currentProjectConfig = null;
    showEmptyState('Aucune donnee pour ce projet.');
    return;
  }

  const projectConfig = await fetchProjectConfig(selectedProject);
  const devisMap = await fetchDevisByDocumentType(selectedProject);
  const dashboardData = buildDashboardData(projectRecords, devisMap, projectConfig.rules);

  state.currentProjectConfig = projectConfig;

  showDashboard();
  renderStatsTable(dashboardData.tableRows, dashboardData.totals);
  renderSidePanel(dashboardData, projectRecords, projectConfig);
  renderChart(dashboardData.chart);
}

function clearOutput() {
  elements.statsOutput.innerHTML = '';
}

function showEmptyState(message) {
  destroyChart();
  hideDashboard();
  elements.statsOutput.innerHTML = `<p>${escapeHtml(message)}</p>`;
}

function hideDashboard() {
  elements.chartContainer.style.display = 'none';
  elements.averageIndicesContainer.style.display = 'none';
}

function showDashboard() {
  elements.chartContainer.style.display = 'block';
  elements.averageIndicesContainer.style.display = 'block';
}

function getProjectRecords(selectedProject) {
  return state.records.filter(
    (record) => getRecordProjectName(record) === selectedProject,
  );
}

async function fetchProjectConfig(selectedProject) {
  try {
    const projectsTable = await grist.docApi.fetchTable(TABLES.projects);
    const projectRow = findProjectRow(projectsTable, selectedProject);
    const hasAvancementColumn = tableHasColumn(projectsTable, PROJECT_COLUMNS.avancement);

    if (!projectRow) {
      return createProjectConfig({
        canSave: false,
        warning: 'Projet introuvable dans la table Projets.',
      });
    }

    if (!hasAvancementColumn) {
      return createProjectConfig({
        id: projectRow[PROJECT_COLUMNS.id],
        canSave: false,
        warning: 'Colonne Projets.Avancement introuvable.',
      });
    }

    const parsedRules = parseAvancementRules(projectRow[PROJECT_COLUMNS.avancement]);

    return createProjectConfig({
      id: projectRow[PROJECT_COLUMNS.id],
      rules: parsedRules.rules,
      canSave: !parsedRules.error,
      warning: parsedRules.error
        ? 'JSON invalide dans Projets.Avancement. Corrige ou vide la cellule.'
        : '',
    });
  } catch (error) {
    console.error('Erreur chargement Projets.Avancement :', error);
    return createProjectConfig({
      canSave: false,
      warning: 'Impossible de charger la configuration Avancement du projet.',
    });
  }
}

function createProjectConfig({ id = null, rules = [], canSave = false, warning = '' }) {
  return {
    id,
    rules,
    canSave,
    warning,
  };
}

function findProjectRow(projectsTable, selectedProject) {
  const rows = tableToRows(projectsTable);

  return rows.find(
    (row) => normalizeText(row[PROJECT_COLUMNS.name]) === selectedProject,
  );
}

function tableToRows(table) {
  if (Array.isArray(table)) {
    return table;
  }

  if (!table || !Array.isArray(table.id)) {
    return [];
  }

  return table.id.map((_id, index) => {
    const row = {};

    Object.keys(table).forEach((columnName) => {
      if (Array.isArray(table[columnName])) {
        row[columnName] = table[columnName][index];
      }
    });

    return row;
  });
}

function tableHasColumn(table, columnName) {
  if (Array.isArray(table)) {
    return table.some((row) => Object.prototype.hasOwnProperty.call(row, columnName));
  }

  return Boolean(table && Object.prototype.hasOwnProperty.call(table, columnName));
}

function parseAvancementRules(rawValue) {
  if (rawValue == null || rawValue === '') {
    return { rules: [], error: null };
  }

  try {
    const parsed = typeof rawValue === 'string' ? JSON.parse(rawValue) : rawValue;

    if (!Array.isArray(parsed)) {
      return { rules: [], error: new Error('Avancement must be an array') };
    }

    return {
      rules: dedupeRules(parsed.map(normalizeRule).filter(Boolean)),
      error: null,
    };
  } catch (error) {
    return { rules: [], error };
  }
}

function normalizeRule(rule) {
  const typeDocument = normalizeText(rule?.typeDocument);
  const indice = normalizeIndice(rule?.indice);

  if (!typeDocument || !indice) {
    return null;
  }

  return {
    typeDocument,
    indice,
  };
}

function dedupeRules(rules) {
  const seen = new Set();

  return rules.filter((rule) => {
    const key = getRuleKey(rule);

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

async function fetchDevisByDocumentType(selectedProject) {
  const ventilationData = await grist.docApi.fetchTable(TABLES.ventilation);
  const devisMap = {};

  for (let index = 0; index < ventilationData.id.length; index += 1) {
    if (normalizeText(ventilationData.gristHelper_Display[index]) === selectedProject) {
      const documentType = normalizeText(ventilationData.Type_document[index]);
      devisMap[documentType] = ventilationData.Budget[index] || 0;
    }
  }

  return devisMap;
}

function buildDashboardData(projectRecords, devisMap, customRules) {
  const statsByType = buildStatsByType(projectRecords);
  const averageIndices = buildAverageIndices(projectRecords);
  const sortedTypes = Object.keys(statsByType).sort(compareText);
  const totalDevis = sumDevis(sortedTypes, devisMap);
  const standardRows = buildTableRows(sortedTypes, statsByType, devisMap, totalDevis);
  const customRows = buildCustomRows(customRules, projectRecords, devisMap, totalDevis);
  const tableRows = [...standardRows, ...customRows];
  const totals = buildTotals(statsByType, totalDevis, standardRows);
  const chart = buildChartData(tableRows, totals);

  return {
    averageIndices,
    chart,
    customRows,
    sortedTypes,
    tableRows,
    totals,
  };
}

function buildStatsByType(projectRecords) {
  const statsByType = {};
  const documentTypes = getDocumentTypes(projectRecords);

  documentTypes.forEach((type) => {
    statsByType[type] = createStatsBucket();
  });

  projectRecords.forEach((record) => {
    const type = getDocumentType(record);
    const documentNumber = normalizeText(record.NumeroDocument);

    if (!documentNumber) {
      return;
    }

    statsByType[type].totalDocs.add(documentNumber);

    if (getRecordIndice(record) === INDICES.advanced) {
      statsByType[type].advancedDocs.add(documentNumber);
    }
  });

  return statsByType;
}

function getDocumentTypes(projectRecords) {
  return [...new Set(projectRecords.map(getDocumentType))]
    .filter(Boolean)
    .sort(compareText);
}

function getDocumentType(record) {
  return normalizeText(record.Type_document) || DOCUMENT_TYPES.unspecified;
}

function createStatsBucket() {
  return {
    totalDocs: new Set(),
    advancedDocs: new Set(),
  };
}

function buildAverageIndices(projectRecords) {
  const averageIndices = {};

  projectRecords.forEach((record) => {
    const type = getDocumentType(record);
    const indice = getRecordIndice(record);

    if (!averageIndices[type]) {
      averageIndices[type] = { withIndex: 0, withIndexZero: 0 };
    }

    if (indice) {
      averageIndices[type].withIndex += 1;
    }

    if (indice === INDICES.advanced) {
      averageIndices[type].withIndexZero += 1;
    }
  });

  return averageIndices;
}

function sumDevis(sortedTypes, devisMap) {
  return sortedTypes.reduce((total, type) => total + getDevis(type, devisMap), 0);
}

function buildTableRows(sortedTypes, statsByType, devisMap, totalDevis) {
  return sortedTypes.map((type) => {
    const total = statsByType[type].totalDocs.size;
    const withIndice = statsByType[type].advancedDocs.size;
    const withoutIndice = total - withIndice;
    const percentage = total > 0 ? (withIndice / total) * 100 : 0;
    const devis = getDevis(type, devisMap);
    const percentageDevis = totalDevis > 0 ? (percentage * devis) / totalDevis : 0;

    return {
      label: type,
      type,
      total,
      withIndice,
      withoutIndice,
      percentage,
      devis,
      percentageDevis,
      isCustom: false,
    };
  });
}

function buildCustomRows(customRules, projectRecords, devisMap, totalDevis) {
  return customRules
    .map((rule) => buildCustomRow(rule, projectRecords, devisMap, totalDevis))
    .sort((a, b) => compareText(a.label, b.label));
}

function buildCustomRow(rule, projectRecords, devisMap, totalDevis) {
  const recordsByType = projectRecords.filter(
    (record) => getDocumentType(record) === rule.typeDocument,
  );
  const totalDocs = new Set();
  const docsWithIndice = new Set();

  recordsByType.forEach((record) => {
    const documentNumber = normalizeText(record.NumeroDocument);

    if (!documentNumber) {
      return;
    }

    totalDocs.add(documentNumber);

    if (getRecordIndice(record) === rule.indice) {
      docsWithIndice.add(documentNumber);
    }
  });

  const total = totalDocs.size;
  const withIndice = docsWithIndice.size;
  const withoutIndice = total - withIndice;
  const percentage = total > 0 ? (withIndice / total) * 100 : 0;
  const devis = getDevis(rule.typeDocument, devisMap);
  const percentageDevis = totalDevis > 0 ? (percentage * devis) / totalDevis : 0;

  return {
    label: `${rule.typeDocument} - Indice ${rule.indice}`,
    type: rule.typeDocument,
    indice: rule.indice,
    total,
    withIndice,
    withoutIndice,
    percentage,
    devis,
    percentageDevis,
    isCustom: true,
  };
}

function getDevis(type, devisMap) {
  return devisMap[type] || 0;
}

function buildTotals(statsByType, totalDevis, standardRows) {
  const totals = Object.values(statsByType).reduce(
    (result, stats) => {
      result.totalDocs += stats.totalDocs.size;
      result.withIndice += stats.advancedDocs.size;
      return result;
    },
    {
      totalDocs: 0,
      withIndice: 0,
    },
  );

  const withoutIndice = totals.totalDocs - totals.withIndice;
  const percentage =
    totals.totalDocs > 0 ? (totals.withIndice / totals.totalDocs) * 100 : 0;
  const percentageDevis = standardRows.reduce(
    (total, row) => total + row.percentageDevis,
    0,
  );

  return {
    totalDocs: totals.totalDocs,
    withIndice: totals.withIndice,
    withoutIndice,
    percentage,
    totalDevis,
    percentageDevis,
  };
}

function buildChartData(tableRows, totals) {
  const labels = tableRows.map((row) => row.label);
  const dataWithIndice = tableRows.map((row) => row.percentage);
  const dataWithoutIndice = tableRows.map((row) => percentageWithoutIndice(row));
  const rawCountsWithIndice = tableRows.map((row) => row.withIndice);
  const rawCountsWithoutIndice = tableRows.map((row) => row.withoutIndice);

  labels.push(DOCUMENT_TYPES.total);
  dataWithIndice.push(totals.percentage);
  dataWithoutIndice.push(percentageWithoutIndice(totals));
  rawCountsWithIndice.push(totals.withIndice);
  rawCountsWithoutIndice.push(totals.withoutIndice);

  return {
    labels,
    dataWithIndice,
    dataWithoutIndice,
    rawCountsWithIndice,
    rawCountsWithoutIndice,
  };
}

function percentageWithoutIndice(row) {
  const total = Number.isFinite(row.total) ? row.total : row.totalDocs;
  return total > 0 ? 100 - row.percentage : 0;
}

function renderStatsTable(tableRows, totals) {
  elements.statsOutput.innerHTML = `
    <table class="summary-table">
      <thead>
        <tr>
          <th>Type de document</th>
          <th>Plans a l'indice</th>
          <th>Plans sans l'indice</th>
          <th>Nombre total</th>
          <th>Pourcentage plans</th>
          <th>Devis</th>
          <th>Pourcentage devis</th>
        </tr>
      </thead>
      <tbody>
        ${tableRows.map(renderStatsRow).join('')}
        ${renderTotalRow(totals)}
      </tbody>
    </table>
  `;
}

function renderStatsRow(row) {
  return `
    <tr class="${row.isCustom ? 'custom-row' : ''}">
      <td>${escapeHtml(row.label)}</td>
      <td>${row.withIndice}</td>
      <td>${row.withoutIndice}</td>
      <td>${row.total}</td>
      <td>${formatPercentage(row.percentage)}</td>
      <td>${formatNumber(row.devis)}</td>
      <td>${formatPercentage(row.percentageDevis)}</td>
    </tr>
  `;
}

function renderTotalRow(totals) {
  return `
    <tr class="total-row">
      <td><strong>${DOCUMENT_TYPES.total}</strong></td>
      <td><strong>${totals.withIndice}</strong></td>
      <td><strong>${totals.withoutIndice}</strong></td>
      <td><strong>${totals.totalDocs}</strong></td>
      <td><strong>${formatPercentage(totals.percentage)}</strong></td>
      <td><strong>${formatNumber(totals.totalDevis)}</strong></td>
      <td><strong>${formatPercentage(totals.percentageDevis)}</strong></td>
    </tr>
  `;
}

function renderSidePanel(dashboardData, projectRecords, projectConfig) {
  elements.averageIndicesContainer.innerHTML = `
    ${renderAverageIndices(dashboardData.averageIndices, dashboardData.sortedTypes)}
    ${renderCustomRulesPanel(projectRecords, projectConfig)}
  `;

  bindCustomRuleControls(projectRecords);
}

function renderAverageIndices(averageIndices, sortedTypes) {
  const lines = sortedTypes
    .map((type) => renderAverageIndexLine(type, averageIndices[type]))
    .join('');

  return `<section class="average-indices"><h3>Indice moyen</h3>${lines}</section>`;
}

function renderAverageIndexLine(type, averageData) {
  const average =
    averageData && averageData.withIndexZero > 0
      ? (averageData.withIndex / averageData.withIndexZero).toFixed(2)
      : 'N/A';

  return `<p><strong>${escapeHtml(type)}:</strong> ${average}</p>`;
}

function renderCustomRulesPanel(projectRecords, projectConfig) {
  const documentTypes = getDocumentTypes(projectRecords);
  const controlsDisabled = !projectConfig.canSave || documentTypes.length === 0;

  return `
    <section class="custom-rules-panel">
      <h3>Indices a afficher</h3>
      ${renderProjectConfigWarning(projectConfig)}
      ${renderCustomRulesList(projectConfig.rules, controlsDisabled)}
      ${renderCustomRuleForm(documentTypes, controlsDisabled)}
      ${renderRuleFeedback()}
    </section>
  `;
}

function renderProjectConfigWarning(projectConfig) {
  if (!projectConfig.warning) {
    return '';
  }

  return `<p class="rules-feedback rules-feedback-error">${escapeHtml(projectConfig.warning)}</p>`;
}

function renderCustomRulesList(rules, controlsDisabled) {
  if (rules.length === 0) {
    return '<p class="rules-empty">Aucune regle.</p>';
  }

  return `
    <ul class="rules-list">
      ${rules
        .map((rule, index) => renderCustomRuleItem(rule, index, controlsDisabled))
        .join('')}
    </ul>
  `;
}

function renderCustomRuleItem(rule, index, controlsDisabled) {
  return `
    <li class="rules-list-item">
      <span>${escapeHtml(rule.typeDocument)} - Indice ${escapeHtml(rule.indice)}</span>
      <button
        type="button"
        class="rules-delete-button"
        data-rule-index="${index}"
        title="Supprimer"
        aria-label="Supprimer ${escapeHtml(rule.typeDocument)} indice ${escapeHtml(rule.indice)}"
        ${controlsDisabled ? 'disabled' : ''}
      >x</button>
    </li>
  `;
}

function renderCustomRuleForm(documentTypes, controlsDisabled) {
  return `
    <div class="rules-form">
      <label class="rules-field" for="${SELECTORS.ruleTypeSelect}">
        <span>Type</span>
        <select id="${SELECTORS.ruleTypeSelect}" ${controlsDisabled ? 'disabled' : ''}>
          <option value="">Choisir</option>
          ${renderSelectOptions(documentTypes)}
        </select>
      </label>

      <label class="rules-field" for="${SELECTORS.ruleIndiceSelect}">
        <span>Indice</span>
        <select id="${SELECTORS.ruleIndiceSelect}" disabled>
          <option value="">Choisir</option>
        </select>
      </label>

      <button
        type="button"
        id="${SELECTORS.addRuleButton}"
        class="rules-add-button"
        ${controlsDisabled ? 'disabled' : ''}
      >Ajouter</button>
    </div>
  `;
}

function renderSelectOptions(values) {
  return values
    .map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`)
    .join('');
}

function renderRuleFeedback() {
  if (!state.ruleFeedback) {
    return `<p id="${SELECTORS.ruleFeedback}" class="rules-feedback"></p>`;
  }

  return `
    <p id="${SELECTORS.ruleFeedback}" class="rules-feedback rules-feedback-${state.ruleFeedback.type}">
      ${escapeHtml(state.ruleFeedback.message)}
    </p>
  `;
}

function bindCustomRuleControls(projectRecords) {
  const typeSelect = document.getElementById(SELECTORS.ruleTypeSelect);
  const indiceSelect = document.getElementById(SELECTORS.ruleIndiceSelect);
  const addButton = document.getElementById(SELECTORS.addRuleButton);
  const deleteButtons = document.querySelectorAll('.rules-delete-button');

  if (typeSelect && indiceSelect) {
    typeSelect.addEventListener('change', () => {
      updateIndiceOptions(projectRecords);
      updateAddRuleButtonState();
    });
    indiceSelect.addEventListener('change', updateAddRuleButtonState);
  }

  if (addButton) {
    addButton.addEventListener('click', handleAddRule);
    updateAddRuleButtonState();
  }

  deleteButtons.forEach((button) => {
    button.addEventListener('click', () => handleDeleteRule(button));
  });
}

function updateIndiceOptions(projectRecords) {
  const typeSelect = document.getElementById(SELECTORS.ruleTypeSelect);
  const indiceSelect = document.getElementById(SELECTORS.ruleIndiceSelect);

  if (!typeSelect || !indiceSelect) {
    return;
  }

  const selectedType = normalizeText(typeSelect.value);
  const indices = selectedType ? getIndicesForDocumentType(projectRecords, selectedType) : [];

  indiceSelect.innerHTML = `
    <option value="">Choisir</option>
    ${renderSelectOptions(indices)}
  `;
  indiceSelect.disabled = !state.currentProjectConfig?.canSave || indices.length === 0;
}

function updateAddRuleButtonState() {
  const typeSelect = document.getElementById(SELECTORS.ruleTypeSelect);
  const indiceSelect = document.getElementById(SELECTORS.ruleIndiceSelect);
  const addButton = document.getElementById(SELECTORS.addRuleButton);

  if (!typeSelect || !indiceSelect || !addButton) {
    return;
  }

  addButton.disabled =
    !state.currentProjectConfig?.canSave ||
    !normalizeText(typeSelect.value) ||
    !normalizeIndice(indiceSelect.value);
}

function getIndicesForDocumentType(projectRecords, documentType) {
  return [...new Set(
    projectRecords
      .filter((record) => getDocumentType(record) === documentType)
      .map(getRecordIndice)
      .filter(Boolean),
  )].sort(compareText);
}

async function handleAddRule() {
  const typeSelect = document.getElementById(SELECTORS.ruleTypeSelect);
  const indiceSelect = document.getElementById(SELECTORS.ruleIndiceSelect);
  const typeDocument = normalizeText(typeSelect?.value);
  const indice = normalizeIndice(indiceSelect?.value);

  if (!typeDocument || !indice) {
    setRuleFeedback('error', 'Selection incomplete.');
    return;
  }

  if (!state.currentProjectConfig?.canSave) {
    setRuleFeedback('error', 'Sauvegarde indisponible.');
    return;
  }

  const nextRule = { typeDocument, indice };
  const existingRules = state.currentProjectConfig.rules;

  if (existingRules.some((rule) => getRuleKey(rule) === getRuleKey(nextRule))) {
    setRuleFeedback('error', 'Cette regle existe deja.');
    return;
  }

  await saveRules([...existingRules, nextRule], 'Regle ajoutee.');
}

async function handleDeleteRule(button) {
  const ruleIndex = Number(button.dataset.ruleIndex);

  if (!Number.isInteger(ruleIndex) || !state.currentProjectConfig?.canSave) {
    setRuleFeedback('error', 'Suppression indisponible.');
    return;
  }

  const nextRules = state.currentProjectConfig.rules.filter(
    (_rule, index) => index !== ruleIndex,
  );

  await saveRules(nextRules, 'Regle supprimee.');
}

async function saveRules(nextRules, successMessage) {
  try {
    setRuleControlsBusy(true);

    await grist.docApi.applyUserActions([
      [
        'UpdateRecord',
        TABLES.projects,
        state.currentProjectConfig.id,
        {
          [PROJECT_COLUMNS.avancement]: JSON.stringify(dedupeRules(nextRules)),
        },
      ],
    ]);

    state.ruleFeedback = { type: 'success', message: successMessage };
    await updateDashboard();
  } catch (error) {
    console.error('Erreur sauvegarde Projets.Avancement :', error);
    setRuleFeedback('error', 'Erreur lors de la sauvegarde.');
  } finally {
    setRuleControlsBusy(false);
  }
}

function setRuleControlsBusy(isBusy) {
  const typeSelect = document.getElementById(SELECTORS.ruleTypeSelect);
  const indiceSelect = document.getElementById(SELECTORS.ruleIndiceSelect);
  const addButton = document.getElementById(SELECTORS.addRuleButton);
  const deleteButtons = document.querySelectorAll('.rules-delete-button');
  const canSave = Boolean(state.currentProjectConfig?.canSave);

  if (typeSelect) {
    typeSelect.disabled = isBusy || !canSave;
  }

  if (indiceSelect) {
    indiceSelect.disabled =
      isBusy ||
      !canSave ||
      !normalizeText(typeSelect?.value) ||
      indiceSelect.options.length <= 1;
  }

  if (addButton) {
    addButton.disabled =
      isBusy ||
      !canSave ||
      !normalizeText(typeSelect?.value) ||
      !normalizeIndice(indiceSelect?.value);
  }

  deleteButtons.forEach((button) => {
    button.disabled = isBusy || !canSave;
  });
}

function setRuleFeedback(type, message) {
  state.ruleFeedback = { type, message };

  const feedback = document.getElementById(SELECTORS.ruleFeedback);
  if (feedback) {
    feedback.className = `rules-feedback rules-feedback-${type}`;
    feedback.textContent = message;
  }
}

function getRuleKey(rule) {
  return `${rule.typeDocument}||${rule.indice}`;
}

function renderChart(chartData) {
  const ctx = elements.chartCanvas.getContext('2d');

  destroyChart();

  state.chart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: chartData.labels,
      datasets: [
        buildChartDataset(
          'Avance',
          chartData.dataWithIndice,
          chartData.rawCountsWithIndice,
          'rgba(75, 192, 192, 0.5)',
        ),
        buildChartDataset(
          'Non avance',
          chartData.dataWithoutIndice,
          chartData.rawCountsWithoutIndice,
          'rgba(255, 99, 132, 0.5)',
        ),
      ],
    },
    options: getChartOptions(),
  });
}

function buildChartDataset(label, data, rawCounts, backgroundColor) {
  return {
    label,
    data,
    backgroundColor,
    datalabels: {
      labels: {
        value: {
          formatter: (_value, context) => rawCounts[context.dataIndex],
        },
      },
    },
  };
}

function getChartOptions() {
  return {
    indexAxis: 'y',
    scales: {
      x: {
        stacked: true,
        max: 100,
        ticks: {
          callback: (value) => `${value}%`,
        },
      },
      y: {
        stacked: true,
      },
    },
    plugins: {
      title: {
        display: true,
        text: 'Avancement',
      },
      tooltip: {
        callbacks: {
          label: formatTooltipLabel,
        },
      },
      datalabels: {
        color: '#000',
        display: (context) => context.dataset.data[context.dataIndex] > 0,
        font: {
          weight: 'bold',
        },
        formatter: Math.round,
      },
    },
  };
}

function formatTooltipLabel(context) {
  const label = context.dataset.label ? `${context.dataset.label}: ` : '';
  const value = context.parsed.x !== null ? `${context.parsed.x.toFixed(2)}%` : '';

  return `${label}${value}`;
}

function destroyChart() {
  if (state.chart) {
    state.chart.destroy();
    state.chart = null;
  }
}

function getRecordProjectName(record) {
  return normalizeText(record.Nom_projet);
}

function getRecordIndice(record) {
  return normalizeIndice(record.Indice);
}

function normalizeIndice(value) {
  return normalizeText(value);
}

function normalizeText(value) {
  if (value == null) {
    return '';
  }

  if (typeof value === 'object') {
    return normalizeText(
      value.details ??
      value.display ??
      value.label ??
      value.name ??
      value.id ??
      '',
    );
  }

  return String(value).trim().replace(/\s+/g, ' ');
}

function compareText(a, b) {
  return String(a).localeCompare(String(b), 'fr', {
    numeric: true,
    sensitivity: 'base',
  });
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatNumber(value) {
  return String(value ?? 0).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

function formatPercentage(value) {
  return `${value.toFixed(2)}%`;
}
