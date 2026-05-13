const SELECTORS = {
  projectDropdown: 'projectDropdown',
  chartCanvas: 'avancementChart',
  chartContainer: '.chart-container',
  averageIndicesContainer: 'average-indices-container',
  statsOutput: 'stats-output',
  ruleFeedback: 'indexSelectionFeedback',
};

const TABLES = {
  projects: 'Projets',
  budget: 'Budget',
};

const PROJECT_COLUMNS = {
  id: 'id',
  name: 'Nom_de_projet',
  projectNumber: 'Numero_de_projet',
  avancement: 'Avancement',
};

const BUDGET_COLUMNS = {
  projectNumber: 'NumeroProjet',
  chapter: 'Chapter',
  amount: 'Amount',
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
  selectionFeedback: null,
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
    state.selectionFeedback = null;
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
    state.selectionFeedback = null;
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
  const ventilation = await fetchBudgetVentilation(projectConfig, projectRecords);
  const dashboardData = buildDashboardData(projectRecords, ventilation, projectConfig.selections);

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
        projectNumber: normalizeText(projectRow[PROJECT_COLUMNS.projectNumber]),
        canSave: false,
        warning: 'Colonne Projets.Avancement introuvable.',
      });
    }

    const parsedSelections = parseAvancementSelections(projectRow[PROJECT_COLUMNS.avancement]);

    return createProjectConfig({
      id: projectRow[PROJECT_COLUMNS.id],
      projectNumber: normalizeText(projectRow[PROJECT_COLUMNS.projectNumber]),
      selections: parsedSelections.selections,
      canSave: !parsedSelections.error,
      warning: parsedSelections.error
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

function createProjectConfig({
  id = null,
  projectNumber = '',
  selections = [],
  canSave = false,
  warning = '',
}) {
  return {
    id,
    projectNumber,
    selections,
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

function parseAvancementSelections(rawValue) {
  if (rawValue == null || rawValue === '') {
    return { selections: [], error: null };
  }

  try {
    const parsed = typeof rawValue === 'string' ? JSON.parse(rawValue) : rawValue;

    if (!Array.isArray(parsed)) {
      return { selections: [], error: new Error('Avancement must be an array') };
    }

    return {
      selections: dedupeSelections(parsed.map(normalizeSelection).filter(Boolean)),
      error: null,
    };
  } catch (error) {
    return { selections: [], error };
  }
}

function normalizeSelection(selection) {
  const typeDocument = normalizeText(selection?.typeDocument);
  const indice = normalizeIndice(selection?.indice);

  if (!typeDocument || !indice) {
    return null;
  }

  return {
    typeDocument,
    indice,
  };
}

function dedupeSelections(selections) {
  const seen = new Set();

  return selections.filter((selection) => {
    const key = selection.typeDocument;

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

async function fetchBudgetVentilation(projectConfig, projectRecords) {
  const emptyVentilation = {
    byType: {},
    unmatchedRows: [],
    total: 0,
  };

  if (!projectConfig.projectNumber) {
    return emptyVentilation;
  }

  try {
    const budgetTable = await grist.docApi.fetchTable(TABLES.budget);
    const documentTypes = getDocumentTypes(projectRecords);
    const projectBudgetRows = tableToRows(budgetTable)
      .filter((row) => normalizeText(row[BUDGET_COLUMNS.projectNumber]) === projectConfig.projectNumber)
      .map((row) => ({
        chapter: normalizeText(row[BUDGET_COLUMNS.chapter]),
        amount: toNumber(row[BUDGET_COLUMNS.amount]),
      }))
      .filter((row) => row.chapter || row.amount !== 0);

    return buildBudgetVentilation(projectBudgetRows, documentTypes);
  } catch (error) {
    console.error('Erreur chargement Budget :', error);
    return emptyVentilation;
  }
}

function buildBudgetVentilation(budgetRows, documentTypes) {
  const byType = {};
  const unmatchedRows = [];
  let total = 0;

  budgetRows.forEach((row) => {
    total += row.amount;

    const matchedType = getBudgetDocumentType(row.chapter, documentTypes);
    if (matchedType) {
      byType[matchedType] = (byType[matchedType] || 0) + row.amount;
      return;
    }

    unmatchedRows.push(row);
  });

  return {
    byType,
    unmatchedRows,
    total,
  };
}

function getBudgetDocumentType(chapter, documentTypes) {
  const normalizedChapter = normalizeLookupText(chapter);

  if (!normalizedChapter) {
    return '';
  }

  const explicitMatch = getExplicitBudgetDocumentType(normalizedChapter, documentTypes);
  if (explicitMatch) {
    return explicitMatch;
  }

  return documentTypes.find((type) => {
    const normalizedType = normalizeLookupText(type);
    return normalizedType && normalizedChapter.includes(normalizedType);
  }) || '';
}

function getExplicitBudgetDocumentType(normalizedChapter, documentTypes) {
  if (normalizedChapter.includes('plan de coffrage')) {
    return findDocumentType(documentTypes, ['COFFRAGE']);
  }

  if (normalizedChapter.includes('plan de demolition')) {
    return findDocumentType(documentTypes, ['DEMOLITION', 'DÉMOLITION']);
  }

  if (normalizedChapter.includes('plan d armature') || normalizedChapter.includes('plan darmature')) {
    return findDocumentType(documentTypes, ['ARMATURES', 'ARMATURE']);
  }

  if (normalizedChapter.includes('note de calcul')) {
    return findDocumentType(documentTypes, ['NDC']);
  }

  if (normalizedChapter.startsWith('coupes')) {
    return findDocumentType(documentTypes, ['COUPES', 'COUPE']);
  }

  return '';
}

function findDocumentType(documentTypes, candidates) {
  const normalizedCandidates = new Set(candidates.map(normalizeLookupText));

  return documentTypes.find((type) => normalizedCandidates.has(normalizeLookupText(type))) || '';
}

function buildDashboardData(projectRecords, ventilation, indexSelections) {
  const selectedIndicesByType = buildSelectedIndicesByType(projectRecords, indexSelections);
  const statsByType = buildStatsByType(projectRecords, selectedIndicesByType);
  const averageIndices = buildAverageIndices(projectRecords);
  const sortedTypes = Object.keys(statsByType).sort(compareText);
  const standardRows = buildTableRows(sortedTypes, statsByType, ventilation);
  const budgetRows = buildUnmatchedBudgetRows(ventilation.unmatchedRows);
  const totals = buildTotals(statsByType, ventilation.total, standardRows);
  const chart = buildChartData(standardRows, totals);

  return {
    averageIndices,
    chart,
    selectedIndicesByType,
    sortedTypes,
    tableRows: [...budgetRows, ...standardRows],
    totals,
  };
}

function buildSelectedIndicesByType(projectRecords, indexSelections) {
  const selectionMap = new Map(
    indexSelections.map((selection) => [selection.typeDocument, selection.indice]),
  );

  return Object.fromEntries(
    getDocumentTypes(projectRecords).map((type) => {
      const availableIndices = getIndicesForDocumentType(projectRecords, type);
      const selectedIndice = selectionMap.get(type);

      return [
        type,
        availableIndices.includes(selectedIndice) ? selectedIndice : INDICES.advanced,
      ];
    }),
  );
}

function buildStatsByType(projectRecords, selectedIndicesByType) {
  const statsByType = {};
  const documentTypes = getDocumentTypes(projectRecords);

  documentTypes.forEach((type) => {
    statsByType[type] = createStatsBucket(selectedIndicesByType[type] || INDICES.advanced);
  });

  projectRecords.forEach((record) => {
    const type = getDocumentType(record);
    const documentNumber = normalizeText(record.NumeroDocument);

    if (!documentNumber) {
      return;
    }

    statsByType[type].totalDocs.add(documentNumber);

    if (getRecordIndice(record) === statsByType[type].selectedIndice) {
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

function createStatsBucket(selectedIndice) {
  return {
    totalDocs: new Set(),
    advancedDocs: new Set(),
    selectedIndice,
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

function buildTableRows(sortedTypes, statsByType, ventilation) {
  return sortedTypes.map((type) => {
    const total = statsByType[type].totalDocs.size;
    const withIndice = statsByType[type].advancedDocs.size;
    const withoutIndice = total - withIndice;
    const percentage = total > 0 ? (withIndice / total) * 100 : 0;
    const ventilationPrice = getVentilationPrice(type, ventilation);
    const percentageVentilation =
      ventilation.total > 0 ? (percentage * ventilationPrice) / ventilation.total : 0;
    const indice = statsByType[type].selectedIndice;

    return {
      label: getDocumentTypeLabel(type, indice),
      type,
      indice,
      total,
      withIndice,
      withoutIndice,
      percentage,
      ventilationPrice,
      percentageVentilation,
      isBudgetOnly: false,
    };
  });
}

function buildUnmatchedBudgetRows(unmatchedRows) {
  return unmatchedRows.map((row) => ({
    label: formatBudgetChapterLabel(row.chapter),
    type: '',
    indice: '',
    total: null,
    withIndice: null,
    withoutIndice: null,
    percentage: null,
    ventilationPrice: row.amount,
    percentageVentilation: null,
    isBudgetOnly: true,
  }));
}

function formatBudgetChapterLabel(chapter) {
  return normalizeText(chapter).replace(/^\d+\s*-\s*/, '');
}

function getVentilationPrice(type, ventilation) {
  return ventilation.byType[type] || 0;
}

function getDocumentTypeLabel(type, indice) {
  if (!indice || indice === INDICES.advanced) {
    return type;
  }

  return `${type} - Indice ${indice}`;
}

function buildTotals(statsByType, totalVentilation, standardRows) {
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
  const percentageVentilation = standardRows.reduce(
    (total, row) => total + row.percentageVentilation,
    0,
  );

  return {
    totalDocs: totals.totalDocs,
    withIndice: totals.withIndice,
    withoutIndice,
    percentage,
    totalVentilation,
    percentageVentilation,
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
          <th>Ventilation prix</th>
          <th>Pourcentage ventilation</th>
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
    <tr class="${row.isBudgetOnly ? 'budget-only-row' : ''}">
      <td>${escapeHtml(row.label)}</td>
      <td>${formatTableValue(row.withIndice)}</td>
      <td>${formatTableValue(row.withoutIndice)}</td>
      <td>${formatTableValue(row.total)}</td>
      <td>${formatOptionalPercentage(row.percentage)}</td>
      <td>${formatNumber(row.ventilationPrice)}</td>
      <td>${formatOptionalPercentage(row.percentageVentilation)}</td>
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
      <td><strong>${formatNumber(totals.totalVentilation)}</strong></td>
      <td><strong>${formatPercentage(totals.percentageVentilation)}</strong></td>
    </tr>
  `;
}

function renderSidePanel(dashboardData, projectRecords, projectConfig) {
  elements.averageIndicesContainer.innerHTML = `
    ${renderIndexSelectionPanel(projectRecords, projectConfig, dashboardData.selectedIndicesByType)}
  `;

  bindIndexSelectionControls(projectRecords, dashboardData.selectedIndicesByType);
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

function renderIndexSelectionPanel(projectRecords, projectConfig, selectedIndicesByType) {
  const documentTypes = getDocumentTypes(projectRecords);
  const controlsDisabled = !projectConfig.canSave || documentTypes.length === 0;

  return `
    <section class="custom-rules-panel">
      <h3>Indices des graphiques</h3>
      ${renderProjectConfigWarning(projectConfig)}
      ${renderIndexSelectionList(documentTypes, projectRecords, selectedIndicesByType, controlsDisabled)}
      ${renderSelectionFeedback()}
    </section>
  `;
}

function renderProjectConfigWarning(projectConfig) {
  if (!projectConfig.warning) {
    return '';
  }

  return `<p class="rules-feedback rules-feedback-error">${escapeHtml(projectConfig.warning)}</p>`;
}

function renderIndexSelectionList(
  documentTypes,
  projectRecords,
  selectedIndicesByType,
  controlsDisabled,
) {
  return `
    <div class="index-selection-list">
      ${documentTypes
        .map((type) => renderIndexSelectionItem(
          type,
          getIndicesForDocumentType(projectRecords, type),
          selectedIndicesByType[type] || INDICES.advanced,
          controlsDisabled,
        ))
        .join('')}
    </div>
  `;
}

function renderIndexSelectionItem(type, indices, selectedIndice, controlsDisabled) {
  return `
    <label class="index-selection-item">
      <span>${escapeHtml(type)}</span>
      <select
        class="index-selection-select"
        data-type-document="${escapeHtml(type)}"
        ${controlsDisabled ? 'disabled' : ''}
      >
        ${renderSelectOptions(indices, selectedIndice)}
      </select>
    </label>
  `;
}

function renderSelectOptions(values, selectedValue = '') {
  return values
    .map((value) => `
      <option value="${escapeHtml(value)}" ${value === selectedValue ? 'selected' : ''}>
        ${escapeHtml(value)}
      </option>
    `)
    .join('');
}

function renderSelectionFeedback() {
  if (!state.selectionFeedback) {
    return `<p id="${SELECTORS.ruleFeedback}" class="rules-feedback"></p>`;
  }

  return `
    <p id="${SELECTORS.ruleFeedback}" class="rules-feedback rules-feedback-${state.selectionFeedback.type}">
      ${escapeHtml(state.selectionFeedback.message)}
    </p>
  `;
}

function bindIndexSelectionControls(projectRecords, selectedIndicesByType) {
  const selects = document.querySelectorAll('.index-selection-select');

  selects.forEach((select) => {
    select.addEventListener('change', () => {
      handleIndexSelectionChange(projectRecords, selectedIndicesByType);
    });
  });
}

function getIndicesForDocumentType(projectRecords, documentType) {
  const indices = [...new Set(
    projectRecords
      .filter((record) => getDocumentType(record) === documentType)
      .map(getRecordIndice)
      .filter(Boolean),
  )].sort(compareText);

  if (!indices.includes(INDICES.advanced)) {
    indices.unshift(INDICES.advanced);
  }

  return indices;
}

async function handleIndexSelectionChange(projectRecords, selectedIndicesByType) {
  if (!state.currentProjectConfig?.canSave) {
    setSelectionFeedback('error', 'Sauvegarde indisponible.');
    return;
  }

  const selectsByType = new Map(
    [...document.querySelectorAll('.index-selection-select')].map((select) => [
      normalizeText(select.dataset.typeDocument),
      normalizeIndice(select.value),
    ]),
  );

  const nextSelections = getDocumentTypes(projectRecords).map((typeDocument) => {
    return {
      typeDocument,
      indice: selectsByType.get(typeDocument) || selectedIndicesByType[typeDocument] || INDICES.advanced,
    };
  });

  await saveSelections(nextSelections, 'Indices mis a jour.');
}

async function saveSelections(nextSelections, successMessage) {
  try {
    setIndexSelectionControlsBusy(true);

    await grist.docApi.applyUserActions([
      [
        'UpdateRecord',
        TABLES.projects,
        state.currentProjectConfig.id,
        {
          [PROJECT_COLUMNS.avancement]: JSON.stringify(dedupeSelections(nextSelections)),
        },
      ],
    ]);

    state.selectionFeedback = { type: 'success', message: successMessage };
    await updateDashboard();
  } catch (error) {
    console.error('Erreur sauvegarde Projets.Avancement :', error);
    setSelectionFeedback('error', 'Erreur lors de la sauvegarde.');
  } finally {
    setIndexSelectionControlsBusy(false);
  }
}

function setIndexSelectionControlsBusy(isBusy) {
  const selects = document.querySelectorAll('.index-selection-select');
  const canSave = Boolean(state.currentProjectConfig?.canSave);

  selects.forEach((select) => {
    select.disabled = isBusy || !canSave;
  });
}

function setSelectionFeedback(type, message) {
  state.selectionFeedback = { type, message };

  const feedback = document.getElementById(SELECTORS.ruleFeedback);
  if (feedback) {
    feedback.className = `rules-feedback rules-feedback-${type}`;
    feedback.textContent = message;
  }
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

function normalizeLookupText(value) {
  return normalizeText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function toNumber(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }

  const normalizedValue = normalizeText(value)
    .replace(/\s/g, '')
    .replace(',', '.');
  const parsedValue = Number.parseFloat(normalizedValue);

  return Number.isFinite(parsedValue) ? parsedValue : 0;
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

function formatTableValue(value) {
  return value == null ? '-' : value;
}

function formatPercentage(value) {
  return `${value.toFixed(2)}%`;
}

function formatOptionalPercentage(value) {
  return value == null ? '-' : formatPercentage(value);
}
