import { toFiniteNumber, toText } from "../utils/format.js";

const DOCUMENT_TYPES = {
  coffrage: "COFFRAGE",
  fondPlans: "Fond de plans",
  ndc: "NDC",
  unspecified: "Non specifie",
  total: "Total",
};

const DOCUMENT_TYPE_ORDER = {
  ndc: 10,
  demolition: 20,
  fondPlans: 30,
  coffrage: 40,
  coupesDetails: 50,
  armatures: 60,
};

const INDICES = {
  advanced: "0",
  coffrageDefault: "A",
  minimumSelectable: ["0", "A", "B"],
};

const SPECIAL_BUDGET_KEYS = {
  fondPlans: "__FOND_DE_PLANS__",
};

const CHART_COLORS = {
  done: {
    solid: "rgba(43, 123, 201, 1)",
    fill: "rgba(43, 123, 201, 0.58)",
  },
  remaining: {
    solid: "rgba(180, 35, 24, 1)",
    fill: "rgba(180, 35, 24, 0.58)",
  },
};

const chartStateByRoot = new WeakMap();
const feedbackByProjectId = new Map();

function getElements(rootEl) {
  return {
    chartContainer: rootEl.querySelector("#avancement-chart-container"),
    chartCanvas: rootEl.querySelector("#avancement-chart"),
    chartsGrid: rootEl.querySelector("#avancement-charts-grid"),
    expensesChartCanvas: rootEl.querySelector("#avancement-expenses-progress-chart"),
    generalChartCanvas: rootEl.querySelector("#avancement-general-progress-chart"),
    statsOutput: rootEl.querySelector("#avancement-stats-output"),
    sidePanel: rootEl.querySelector("#avancement-side-panel"),
  };
}

function getChartState(rootEl) {
  if (!chartStateByRoot.has(rootEl)) {
    chartStateByRoot.set(rootEl, {
      detailedChart: null,
      expensesChart: null,
      generalChart: null,
    });
  }

  return chartStateByRoot.get(rootEl);
}

function getProjectFeedbackKey(project) {
  return String(project?.id ?? project?.projectNumber ?? "");
}

function getProjectFeedback(project) {
  return feedbackByProjectId.get(getProjectFeedbackKey(project)) || null;
}

function setProjectFeedback(project, type, message) {
  const key = getProjectFeedbackKey(project);
  if (!key) return;

  if (!message) {
    feedbackByProjectId.delete(key);
    return;
  }

  feedbackByProjectId.set(key, { type, message });
}

function normalizeText(value) {
  return toText(value).replace(/\s+/g, " ");
}

function normalizeIndice(value) {
  return normalizeText(value);
}

function normalizeLookupText(value) {
  return normalizeText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizeCompactLookupText(value) {
  return normalizeLookupText(value).replace(/\s+/g, "");
}

function normalizePersonName(value) {
  return normalizeText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function isNoteDeCalculLabel(normalizedValue) {
  return (
    normalizedValue.includes("note de calcul") ||
    normalizedValue.includes("notes de calcul") ||
    normalizedValue.includes("note calcul") ||
    normalizedValue.includes("notes calcul")
  );
}

function getDocumentTypeOrderRank(value) {
  const normalizedValue = normalizeLookupText(value);
  const compactValue = normalizeCompactLookupText(value);

  if (!normalizedValue) {
    return 900;
  }

  if (
    normalizedValue === normalizeLookupText(DOCUMENT_TYPES.ndc) ||
    compactValue === normalizeCompactLookupText(DOCUMENT_TYPES.ndc) ||
    isNoteDeCalculLabel(normalizedValue)
  ) {
    return DOCUMENT_TYPE_ORDER.ndc;
  }

  if (normalizedValue.includes("demolition")) {
    return DOCUMENT_TYPE_ORDER.demolition;
  }

  if (
    normalizedValue.includes("fond de plan") ||
    normalizedValue.includes("fonds de plan") ||
    normalizedValue.includes("fond plans") ||
    normalizedValue.includes("fonds plans") ||
    compactValue.includes("fonddeplans") ||
    compactValue.includes("fondsdeplan")
  ) {
    return DOCUMENT_TYPE_ORDER.fondPlans;
  }

  if (normalizedValue.includes("coffrage")) {
    return DOCUMENT_TYPE_ORDER.coffrage;
  }

  if (
    normalizedValue.includes("coupe") ||
    normalizedValue.includes("detail") ||
    compactValue.includes("coupesdetails")
  ) {
    return DOCUMENT_TYPE_ORDER.coupesDetails;
  }

  if (normalizedValue.includes("armature")) {
    return DOCUMENT_TYPE_ORDER.armatures;
  }

  return 900;
}

function compareDocumentTypes(a, b) {
  const rankDiff = getDocumentTypeOrderRank(a) - getDocumentTypeOrderRank(b);
  return rankDiff || compareText(a, b);
}

function comparePlanRows(a, b) {
  const rankDiff = getDocumentTypeOrderRank(a?.label || a?.tableLabel || a?.type) -
    getDocumentTypeOrderRank(b?.label || b?.tableLabel || b?.type);
  return rankDiff || compareText(a?.label || a?.tableLabel || "", b?.label || b?.tableLabel || "");
}

function normalizeDocumentType(value) {
  const type = normalizeText(value);

  if (!type) {
    return DOCUMENT_TYPES.unspecified;
  }

  const normalizedType = normalizeLookupText(type);
  if (
    normalizeCompactLookupText(type) === normalizeCompactLookupText(DOCUMENT_TYPES.ndc) ||
    isNoteDeCalculLabel(normalizedType)
  ) {
    return DOCUMENT_TYPES.ndc;
  }

  return type;
}

function getRecordIndice(record) {
  return normalizeIndice(record?.Indice);
}

function getDocumentType(record) {
  return normalizeDocumentType(record?.Type_document);
}

function getRecordDocumentKey(record) {
  return [
    normalizeText(record?.NumeroDocument),
    normalizeText(record?.Designation),
    normalizeText(record?.Zone),
  ]
    .map((value) => normalizeLookupText(value))
    .join("||");
}

function getProjectRecords(project) {
  return (project?.avancementRecords || [])
    .map((record) => ({
      id: record?.id,
      NumeroDocument: normalizeText(record?.NumeroDocument),
      Designation: normalizeText(record?.Designation),
      Type_document: normalizeText(record?.Type_document),
      Zone: normalizeText(record?.Zone),
      Indice: normalizeIndice(record?.Indice),
      DateDiffusion: record?.DateDiffusion,
      AvancementSelectedIndice: normalizeIndice(
        record?.AvancementSelectedIndice ?? record?.avancementSelectedIndice,
      ),
    }))
    .filter((record) => normalizeText(record.NumeroDocument) && getDocumentType(record));
}

function parseAvancementConfig(rawValue) {
  if (rawValue == null || rawValue === "") {
    return { selections: [], budgetProgress: [], error: null };
  }

  try {
    const parsed = typeof rawValue === "string" ? JSON.parse(rawValue) : rawValue;

    if (!Array.isArray(parsed)) {
      return {
        selections: [],
        budgetProgress: [],
        error: new Error("Avancement must be an array"),
      };
    }

    return {
      selections: dedupeSelections(parsed.map(normalizeSelection).filter(Boolean)),
      budgetProgress: dedupeBudgetProgress(parsed.map(normalizeBudgetProgress).filter(Boolean)),
      error: null,
    };
  } catch (error) {
    return { selections: [], budgetProgress: [], error };
  }
}

function normalizeSelection(selection) {
  const rawTypeDocument = normalizeText(selection?.typeDocument);
  const typeDocument = rawTypeDocument ? normalizeDocumentType(rawTypeDocument) : "";
  const indice = normalizeIndice(selection?.indice);

  if (!typeDocument || !indice) {
    return null;
  }

  return { typeDocument, indice };
}

function normalizeBudgetProgress(item) {
  const budgetKey = normalizeText(item?.budgetKey);
  const percentage = clampPercentage(toFiniteNumber(item?.percentage, 0));

  if (!budgetKey) {
    return null;
  }

  return { budgetKey, percentage };
}

function dedupeSelections(selections) {
  const seen = new Set();

  return (selections || []).filter((selection) => {
    const key = selection.typeDocument;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function dedupeBudgetProgress(progressItems) {
  const seen = new Set();

  return (progressItems || []).filter((item) => {
    if (seen.has(item.budgetKey)) return false;
    seen.add(item.budgetKey);
    return true;
  });
}

function getProjectConfig(project) {
  const parsedConfig = parseAvancementConfig(project?.avancementConfigRaw);

  return {
    id: project?.id ?? null,
    projectNumber: normalizeText(project?.projectNumber),
    selections: parsedConfig.selections,
    budgetProgress: parsedConfig.budgetProgress,
    canSave: Boolean(project?.id) && !parsedConfig.error,
    warning: parsedConfig.error
      ? "JSON invalide dans Projets2.Avancement. Corrige ou vide la cellule."
      : "",
  };
}

function getDocumentTypes(projectRecords) {
  return [...new Set(projectRecords.map(getDocumentType))]
    .filter(Boolean)
    .sort(compareDocumentTypes);
}

function isCoffrageType(type) {
  return normalizeLookupText(type) === normalizeLookupText(DOCUMENT_TYPES.coffrage);
}

function getDefaultIndiceForDocumentType(type) {
  return isCoffrageType(type) ? INDICES.coffrageDefault : INDICES.advanced;
}

function getIndicesForDocumentType(projectRecords, documentType) {
  const existingIndices = projectRecords
    .filter((record) => getDocumentType(record) === documentType)
    .map(getRecordIndice)
    .filter(Boolean);
  const indices = [...new Set([...INDICES.minimumSelectable, ...existingIndices])]
    .sort(compareIndices);

  if (isCoffrageType(documentType)) {
    return indices.filter((indice) => indice !== INDICES.advanced);
  }

  return indices;
}

function buildSelectedIndicesByType(projectRecords, indexSelections) {
  const selectionMap = new Map(
    (indexSelections || []).map((selection) => [
      normalizeDocumentType(selection.typeDocument),
      selection.indice,
    ]),
  );

  return Object.fromEntries(
    getDocumentTypes(projectRecords).map((type) => {
      const availableIndices = getIndicesForDocumentType(projectRecords, type);
      const selectedIndice = selectionMap.get(type);
      const defaultIndice = getDefaultIndiceForDocumentType(type);

      return [
        type,
        availableIndices.includes(selectedIndice) ? selectedIndice : defaultIndice,
      ];
    }),
  );
}

function getSelectedIndiceForRecord(record, selectedIndicesByType) {
  const recordSelectedIndice = normalizeIndice(record?.AvancementSelectedIndice);
  if (recordSelectedIndice) {
    return recordSelectedIndice;
  }

  const type = getDocumentType(record);
  return selectedIndicesByType[type] || getDefaultIndiceForDocumentType(type);
}

function createStatsBucket(selectedIndice) {
  return {
    totalDocs: new Set(),
    advancedDocs: new Set(),
    selectedIndice,
  };
}

function buildStatsByType(projectRecords, selectedIndicesByType) {
  const statsByType = {};
  const documentTypes = getDocumentTypes(projectRecords);

  documentTypes.forEach((type) => {
    statsByType[type] = createStatsBucket(
      selectedIndicesByType[type] || INDICES.advanced,
    );
  });

  projectRecords.forEach((record) => {
    const type = getDocumentType(record);
    const documentKey = getRecordDocumentKey(record);

    if (!documentKey) {
      return;
    }

    statsByType[type].totalDocs.add(documentKey);

    if (getRecordIndice(record) === getSelectedIndiceForRecord(record, selectedIndicesByType)) {
      statsByType[type].advancedDocs.add(documentKey);
    }
  });

  return statsByType;
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

function buildBudgetVentilation(budgetLines, documentTypes) {
  const byType = {};
  const labelsByType = {};
  const unmatchedRows = [];
  let total = 0;

  (budgetLines || []).forEach((line) => {
    const row = {
      chapter: normalizeText(line?.chapter),
      amount: toFiniteNumber(line?.amount, 0),
    };

    total += row.amount;

    const matchedType = getBudgetDocumentType(row.chapter, documentTypes);
    if (matchedType) {
      byType[matchedType] = (byType[matchedType] || 0) + row.amount;
      labelsByType[matchedType] = [
        ...(labelsByType[matchedType] || []),
        formatBudgetChapterLabel(row.chapter),
      ];
      return;
    }

    unmatchedRows.push(row);
  });

  return {
    byType,
    labelsByType: dedupeBudgetLabels(labelsByType),
    unmatchedRows,
    total,
  };
}

function dedupeBudgetLabels(labelsByType) {
  return Object.fromEntries(
    Object.entries(labelsByType).map(([type, labels]) => [
      type,
      [...new Set(labels.filter(Boolean))],
    ]),
  );
}

function getBudgetDocumentType(chapter, documentTypes) {
  const normalizedChapter = normalizeLookupText(chapter);

  if (!normalizedChapter) {
    return "";
  }

  const explicitMatch = getExplicitBudgetDocumentType(normalizedChapter, documentTypes);
  if (explicitMatch) {
    return explicitMatch;
  }

  return documentTypes.find((type) => {
    const normalizedType = normalizeLookupText(type);
    return normalizedType && normalizedChapter.includes(normalizedType);
  }) || "";
}

function getExplicitBudgetDocumentType(normalizedChapter, documentTypes) {
  if (normalizedChapter.includes("fond de plans")) {
    return SPECIAL_BUDGET_KEYS.fondPlans;
  }

  if (normalizedChapter.includes("plan de coffrage")) {
    return findDocumentType(documentTypes, ["COFFRAGE"]);
  }

  if (normalizedChapter.includes("plan de demolition")) {
    return findDocumentType(documentTypes, ["DEMOLITION", "DÉMOLITION"]);
  }

  if (normalizedChapter.includes("plan d armature") || normalizedChapter.includes("plan darmature")) {
    return findDocumentType(documentTypes, ["ARMATURES", "ARMATURE"]);
  }

  if (isNoteDeCalculLabel(normalizedChapter)) {
    return findDocumentType(documentTypes, [
      DOCUMENT_TYPES.ndc,
      "N.D.C",
      "NOTE DE CALCUL",
      "NOTES DE CALCUL",
    ]);
  }

  if (normalizedChapter.startsWith("coupes")) {
    return findDocumentType(documentTypes, ["COUPES", "COUPE"]);
  }

  return "";
}

function findDocumentType(documentTypes, candidates) {
  const normalizedCandidates = new Set(candidates.map(normalizeLookupText));
  const compactCandidates = new Set(candidates.map(normalizeCompactLookupText));

  return documentTypes.find((type) => {
    return (
      normalizedCandidates.has(normalizeLookupText(type)) ||
      compactCandidates.has(normalizeCompactLookupText(type))
    );
  }) || "";
}

function buildDashboardData(projectRecords, ventilation, projectConfig, realExpenses) {
  const selectedIndicesByType = buildSelectedIndicesByType(projectRecords, projectConfig.selections);
  const statsByType = buildStatsByType(projectRecords, selectedIndicesByType);
  const averageIndices = buildAverageIndices(projectRecords);
  const sortedTypes = Object.keys(statsByType).sort(compareDocumentTypes);
  const fondPlansRows = buildFondPlansRows(projectRecords, ventilation);
  const standardRows = buildTableRows(sortedTypes, statsByType, ventilation);
  const planRows = [...fondPlansRows, ...standardRows].sort(comparePlanRows);
  const chartRows = planRows;
  const budgetRows = buildUnmatchedBudgetRows(
    ventilation.unmatchedRows,
    projectConfig.budgetProgress,
  );
  const tableRows = [...budgetRows, ...planRows];
  const totals = buildTotals(ventilation.total, chartRows, tableRows, realExpenses);
  const chart = buildDetailedChartData(chartRows);

  return {
    averageIndices,
    chart,
    selectedIndicesByType,
    sortedTypes,
    tableRows,
    totals,
  };
}

function buildTableRows(sortedTypes, statsByType, ventilation) {
  return sortedTypes.map((type) => {
    const total = statsByType[type].totalDocs.size;
    const withIndice = statsByType[type].advancedDocs.size;
    const withoutIndice = total - withIndice;
    const percentage = total > 0 ? (withIndice / total) * 100 : 0;
    const ventilationPrice = getVentilationPrice(type, ventilation);
    const percentageVentilation = percentage;
    const doneValue = (ventilationPrice * percentageVentilation) / 100;
    const indice = statsByType[type].selectedIndice;

    return {
      label: type,
      tableLabel: getTableBudgetLabel(type, indice, ventilation),
      type,
      indice,
      total,
      withIndice,
      withoutIndice,
      percentage,
      ventilationPrice,
      percentageVentilation,
      doneValue,
      isBudgetOnly: false,
    };
  });
}

function buildFondPlansRows(projectRecords, ventilation) {
  const coffrageType = findDocumentType(getDocumentTypes(projectRecords), [DOCUMENT_TYPES.coffrage]);
  const ventilationPrice = ventilation.byType[SPECIAL_BUDGET_KEYS.fondPlans] || 0;

  if (!coffrageType || ventilationPrice === 0) {
    return [];
  }

  return [
    buildRowFromRecords({
      label: DOCUMENT_TYPES.fondPlans,
      tableLabel: getTableBudgetLabel(SPECIAL_BUDGET_KEYS.fondPlans, INDICES.advanced, ventilation),
      projectRecords,
      type: coffrageType,
      indice: INDICES.advanced,
      ventilationPrice,
    }),
  ];
}

function buildRowFromRecords({
  label,
  tableLabel = "",
  projectRecords,
  type,
  indice,
  ventilationPrice,
}) {
  const totalDocs = new Set();
  const docsWithIndice = new Set();

  projectRecords.forEach((record) => {
    if (getDocumentType(record) !== type) {
      return;
    }

    const documentKey = getRecordDocumentKey(record);
    if (!documentKey) {
      return;
    }

    totalDocs.add(documentKey);

    if (getRecordIndice(record) === indice) {
      docsWithIndice.add(documentKey);
    }
  });

  const total = totalDocs.size;
  const withIndice = docsWithIndice.size;
  const withoutIndice = total - withIndice;
  const percentage = total > 0 ? (withIndice / total) * 100 : 0;
  const percentageVentilation = percentage;
  const doneValue = (ventilationPrice * percentageVentilation) / 100;

  return {
    label,
    tableLabel: tableLabel || label,
    type,
    indice,
    total,
    withIndice,
    withoutIndice,
    percentage,
    ventilationPrice,
    percentageVentilation,
    doneValue,
    isBudgetOnly: false,
  };
}

function buildUnmatchedBudgetRows(unmatchedRows, budgetProgress) {
  const progressMap = new Map(
    (budgetProgress || []).map((item) => [item.budgetKey, item.percentage]),
  );

  return unmatchedRows.map((row) => {
    const budgetKey = getBudgetProgressKey(row.chapter);
    const percentageVentilation = progressMap.get(budgetKey) ?? 0;

    return {
      label: formatBudgetChapterLabel(row.chapter),
      tableLabel: formatBudgetChapterLabel(row.chapter),
      type: "",
      indice: "",
      total: null,
      withIndice: null,
      withoutIndice: null,
      percentage: null,
      ventilationPrice: row.amount,
      percentageVentilation,
      doneValue: (row.amount * percentageVentilation) / 100,
      budgetKey,
      isBudgetOnly: true,
    };
  });
}

function calculateRealExpenses(project) {
  return (project?.workers || []).reduce((projectTotal, worker) => {
    const workedCosts = worker?.workedCosts;
    if (workedCosts && typeof workedCosts === "object" && Object.keys(workedCosts).length > 0) {
      return projectTotal + Object.values(workedCosts).reduce(
        (total, cost) => total + Math.max(0, toFiniteNumber(cost, 0)),
        0,
      );
    }

    const dailyRate = toFiniteNumber(worker?.dailyRate, 0);
    const workerDays = Object.values(worker?.workedDays || {}).reduce(
      (total, days) => total + Math.max(0, toFiniteNumber(days, 0)),
      0,
    );

    return projectTotal + workerDays * dailyRate;
  }, 0);
}

function formatBudgetChapterLabel(chapter) {
  return normalizeText(chapter).replace(/^\d+\s*-\s*/, "");
}

function getBudgetProgressKey(chapter) {
  return normalizeText(chapter);
}

function getVentilationPrice(type, ventilation) {
  return ventilation.byType[type] || 0;
}

function getTableBudgetLabel(type, indice, ventilation) {
  const budgetLabel = getBudgetLabel(type, ventilation) || type;
  return getDocumentTypeLabel(budgetLabel, indice);
}

function getBudgetLabel(type, ventilation) {
  const labels = ventilation.labelsByType?.[type] || [];
  return labels.length ? labels.join(" / ") : "";
}

function getDocumentTypeLabel(type, indice) {
  if (!indice || indice === INDICES.advanced) {
    return type;
  }

  return `${type} - Indice ${indice}`;
}

function buildTotals(totalVentilation, planRows, valueRows, realExpenses) {
  const totals = planRows.reduce(
    (result, stats) => {
      result.totalDocs += stats.total || 0;
      result.withIndice += stats.withIndice || 0;
      return result;
    },
    { totalDocs: 0, withIndice: 0 },
  );
  const withoutIndice = totals.totalDocs - totals.withIndice;
  const percentage = totals.totalDocs > 0 ? (totals.withIndice / totals.totalDocs) * 100 : 0;
  const doneValue = valueRows.reduce((total, row) => total + row.doneValue, 0);
  const percentageVentilation = totalVentilation > 0 ? (doneValue / totalVentilation) * 100 : 0;

  return {
    totalDocs: totals.totalDocs,
    withIndice: totals.withIndice,
    withoutIndice,
    percentage,
    totalVentilation,
    percentageVentilation,
    doneValue,
    realExpenses,
  };
}

function buildDetailedChartData(rows) {
  return {
    labels: rows.map((row) => row.label),
    dataWithIndice: rows.map((row) => row.percentage),
    dataWithoutIndice: rows.map((row) => getRemainingPercentage(row.percentage, row.total)),
    rawCountsWithIndice: rows.map((row) => row.withIndice),
    rawCountsWithoutIndice: rows.map((row) => row.withoutIndice),
  };
}

function renderStatsTable(outputEl, tableRows, totals, canSave) {
  outputEl.innerHTML = `
    <table class="avancement-summary-table">
      <colgroup>
        <col class="avancement-summary-col-type">
        <col class="avancement-summary-col-plan">
        <col class="avancement-summary-col-plan">
        <col class="avancement-summary-col-plan">
        <col class="avancement-summary-col-money">
        <col class="avancement-summary-col-percent">
        <col class="avancement-summary-col-money">
      </colgroup>
      <thead>
        <tr>
          <th>Type de document</th>
          <th>Plans diffusés</th>
          <th>Plans restants</th>
          <th>Total</th>
          <th>Ventilation prix</th>
          <th>% fait</th>
          <th>Valeur faite</th>
        </tr>
      </thead>
      <tbody>
        ${tableRows.map((row) => renderStatsRow(row, canSave)).join("")}
        ${renderTotalRow(totals)}
      </tbody>
    </table>
  `;
}

function renderStatsRow(row, canSave) {
  return `
    <tr>
      <td>${escapeHtml(row.tableLabel || row.label)}</td>
      <td class="${getPlanCellClass(row)}">${formatTableValue(row.withIndice)}</td>
      <td class="${getPlanCellClass(row)}">${formatTableValue(row.withoutIndice)}</td>
      <td class="${getPlanCellClass(row)}">${formatTableValue(row.total)}</td>
      <td>${formatNumber(row.ventilationPrice)}</td>
      <td>${renderPercentDoneCell(row, canSave)}</td>
      <td>${formatNumber(row.doneValue)}</td>
    </tr>
  `;
}

function renderTotalRow(totals) {
  return `
    <tr class="avancement-total-row">
      <td><strong>${DOCUMENT_TYPES.total}</strong></td>
      <td><strong>${totals.withIndice}</strong></td>
      <td><strong>${totals.withoutIndice}</strong></td>
      <td><strong>${totals.totalDocs}</strong></td>
      <td><strong>${formatNumber(totals.totalVentilation)}</strong></td>
      <td><strong>${formatPercentage(totals.percentageVentilation)}</strong></td>
      <td><strong>${formatNumber(totals.doneValue)}</strong></td>
    </tr>
  `;
}

function renderPercentDoneCell(row, canSave) {
  if (!row.isBudgetOnly) {
    return formatPercentage(row.percentageVentilation);
  }

  const value = formatInputNumber(row.percentageVentilation);

  return `
    <span class="avancement-budget-progress-cell">
      <span
        class="avancement-budget-progress-editable"
        contenteditable="${canSave ? "true" : "false"}"
        role="textbox"
        inputmode="numeric"
        data-can-save="${canSave ? "true" : "false"}"
        data-budget-key="${escapeHtml(row.budgetKey)}"
        data-previous-value="${escapeHtml(value)}"
        aria-disabled="${canSave ? "false" : "true"}"
        aria-label="% fait ${escapeHtml(row.label)}"
      >${escapeHtml(value)}</span>
      <span class="avancement-budget-progress-suffix">%</span>
    </span>
  `;
}

function getPlanCellClass(row) {
  return row.isBudgetOnly ? "avancement-not-applicable-cell" : "";
}

function renderSidePanel(sidePanelEl, project, dashboardData, projectRecords, projectConfig) {
  if (!(sidePanelEl instanceof HTMLElement)) {
    return;
  }

  const layoutEl = sidePanelEl.closest(".avancement-dashboard-layout");
  const panelContent = renderIndexSelectionPanel(
    project,
    projectRecords,
    projectConfig,
    dashboardData.selectedIndicesByType,
  );
  const hasPanelContent = Boolean(panelContent.trim());

  layoutEl?.classList.toggle("avancement-dashboard-layout--full", !hasPanelContent);
  sidePanelEl.hidden = !hasPanelContent;
  sidePanelEl.style.display = hasPanelContent ? "block" : "none";
  sidePanelEl.innerHTML = panelContent;
}

function renderAverageIndices(averageIndices, sortedTypes) {
  const lines = sortedTypes
    .map((type) => renderAverageIndexLine(type, averageIndices[type]))
    .join("");

  return `<section class="avancement-average-indices"><h3>Indice moyen</h3>${lines}</section>`;
}

function renderAverageIndexLine(type, averageData) {
  const average =
    averageData && averageData.withIndexZero > 0
      ? (averageData.withIndex / averageData.withIndexZero).toFixed(2)
      : "N/A";

  return `<p><strong>${escapeHtml(type)}:</strong> ${average}</p>`;
}

function renderIndexSelectionPanel(project, projectRecords, projectConfig, selectedIndicesByType) {
  if (toFiniteNumber(project?.globalSourceProjectCount, 0) > 1) {
    return "";
  }

  const documentTypes = getDocumentTypes(projectRecords);
  const controlsDisabled = !projectConfig.canSave || documentTypes.length === 0;

  return `
    <section class="avancement-custom-rules-panel">
      <h3>Indices des graphiques</h3>
      ${renderProjectConfigWarning(projectConfig)}
      ${renderIndexSelectionList(documentTypes, projectRecords, selectedIndicesByType, controlsDisabled)}
      ${renderSelectionFeedback(project)}
    </section>
  `;
}

function renderProjectConfigWarning(projectConfig) {
  if (!projectConfig.warning) {
    return "";
  }

  return `<p class="avancement-rules-feedback avancement-rules-feedback-error">${escapeHtml(projectConfig.warning)}</p>`;
}

function renderIndexSelectionList(
  documentTypes,
  projectRecords,
  selectedIndicesByType,
  controlsDisabled,
) {
  return `
    <div class="avancement-index-selection-list">
      ${documentTypes
        .map((type) => renderIndexSelectionItem(
          type,
          getIndicesForDocumentType(projectRecords, type),
          selectedIndicesByType[type] || getDefaultIndiceForDocumentType(type),
          controlsDisabled,
        ))
        .join("")}
    </div>
  `;
}

function renderIndexSelectionItem(type, indices, selectedIndice, controlsDisabled) {
  return `
    <label class="avancement-index-selection-item">
      <span>${escapeHtml(type)}</span>
      <select
        class="avancement-index-selection-select"
        data-type-document="${escapeHtml(type)}"
        data-can-save="${controlsDisabled ? "false" : "true"}"
        ${controlsDisabled ? "disabled" : ""}
      >
        ${renderSelectOptions(indices, selectedIndice)}
      </select>
    </label>
  `;
}

function renderSelectOptions(values, selectedValue = "") {
  return values
    .map((value) => `
      <option value="${escapeHtml(value)}" ${value === selectedValue ? "selected" : ""}>
        ${escapeHtml(value)}
      </option>
    `)
    .join("");
}

function renderSelectionFeedback(project) {
  const feedback = getProjectFeedback(project);
  if (!feedback) {
    return `<p class="avancement-rules-feedback"></p>`;
  }

  return `
    <p class="avancement-rules-feedback avancement-rules-feedback-${feedback.type}">
      ${escapeHtml(feedback.message)}
    </p>
  `;
}

function bindIndexSelectionControls(rootEl, project, projectRecords, selectedIndicesByType, options) {
  const selects = rootEl.querySelectorAll(".avancement-index-selection-select");

  selects.forEach((select) => {
    select.addEventListener("change", () => {
      handleIndexSelectionChange(rootEl, project, projectRecords, selectedIndicesByType, options);
    });
  });
}

function bindBudgetProgressControls(rootEl, project, options) {
  const editables = rootEl.querySelectorAll(".avancement-budget-progress-editable");

  editables.forEach((editable) => {
    editable.addEventListener("focus", () => {
      editable.dataset.previousValue = formatInputNumber(toFiniteNumber(editable.textContent, 0));
      selectEditableContent(editable);
    });

    editable.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        editable.blur();
      }

      if (event.key === "Escape") {
        event.preventDefault();
        editable.textContent = editable.dataset.previousValue || "0";
        editable.blur();
      }
    });

    editable.addEventListener("blur", () => {
      handleBudgetProgressChange(rootEl, project, editable, options);
    });
  });
}

async function handleIndexSelectionChange(
  rootEl,
  project,
  projectRecords,
  selectedIndicesByType,
  options,
) {
  const projectConfig = getProjectConfig(project);
  if (!projectConfig.canSave) {
    setProjectFeedback(project, "error", "Sauvegarde indisponible.");
    renderAvancementDashboard(rootEl, project, options);
    return;
  }

  const selectsByType = new Map(
    [...rootEl.querySelectorAll(".avancement-index-selection-select")].map((select) => [
      normalizeText(select.dataset.typeDocument),
      normalizeIndice(select.value),
    ]),
  );

  const nextSelections = getDocumentTypes(projectRecords).map((typeDocument) => {
    return {
      typeDocument,
      indice:
        selectsByType.get(typeDocument) ||
        selectedIndicesByType[typeDocument] ||
        getDefaultIndiceForDocumentType(typeDocument),
    };
  });

  await saveAvancementConfig(rootEl, project, options, {
    selections: nextSelections,
    budgetProgress: projectConfig.budgetProgress,
    successMessage: "Indices mis a jour.",
  });
}

async function handleBudgetProgressChange(rootEl, project, changedEditable, options) {
  const projectConfig = getProjectConfig(project);
  if (!projectConfig.canSave) {
    setProjectFeedback(project, "error", "Sauvegarde indisponible.");
    renderAvancementDashboard(rootEl, project, options);
    return;
  }

  if (changedEditable) {
    const nextValue = formatInputNumber(clampPercentage(toFiniteNumber(changedEditable.textContent, 0)));
    const previousValue = changedEditable.dataset.previousValue || "0";

    changedEditable.textContent = nextValue;

    if (nextValue === previousValue) {
      return;
    }
  }

  const nextBudgetProgress = [...rootEl.querySelectorAll(".avancement-budget-progress-editable")]
    .map((editable) => ({
      budgetKey: normalizeText(editable.dataset.budgetKey),
      percentage: clampPercentage(toFiniteNumber(editable.textContent, 0)),
    }))
    .filter((item) => item.budgetKey);

  await saveAvancementConfig(rootEl, project, options, {
    selections: projectConfig.selections,
    budgetProgress: nextBudgetProgress,
    successMessage: "% fait mis a jour.",
  });
}

async function saveAvancementConfig(
  rootEl,
  project,
  options,
  { selections, budgetProgress, successMessage },
) {
  const onSave = options?.onSave;
  if (typeof onSave !== "function") {
    setProjectFeedback(project, "error", "Sauvegarde indisponible.");
    renderAvancementDashboard(rootEl, project, options);
    return;
  }

  try {
    setIndexSelectionControlsBusy(rootEl, true);
    setBudgetProgressControlsBusy(rootEl, true);

    const serializedConfig = JSON.stringify([
      ...dedupeSelections(selections),
      ...dedupeBudgetProgress(budgetProgress),
    ]);

    await onSave(project, serializedConfig);
    project.avancementConfigRaw = serializedConfig;
    setProjectFeedback(project, "success", successMessage || "Configuration mise a jour.");
    renderAvancementDashboard(rootEl, project, options);
  } catch (error) {
    console.error("Erreur sauvegarde Projets2.Avancement :", error);
    setProjectFeedback(project, "error", "Erreur lors de la sauvegarde.");
    renderAvancementDashboard(rootEl, project, options);
  } finally {
    setIndexSelectionControlsBusy(rootEl, false);
    setBudgetProgressControlsBusy(rootEl, false);
  }
}

function setIndexSelectionControlsBusy(rootEl, isBusy) {
  rootEl.querySelectorAll(".avancement-index-selection-select").forEach((select) => {
    select.disabled = isBusy || select.dataset.canSave !== "true";
  });
}

function setBudgetProgressControlsBusy(rootEl, isBusy) {
  rootEl.querySelectorAll(".avancement-budget-progress-editable").forEach((editable) => {
    const canSave = editable.dataset.canSave === "true";
    const isEnabled = !isBusy && canSave;

    editable.contentEditable = String(isEnabled);
    editable.setAttribute("aria-disabled", String(!isEnabled));
    editable.classList.toggle("is-disabled", !isEnabled);
  });
}

function selectEditableContent(element) {
  const selection = window.getSelection();
  const range = document.createRange();

  if (!selection) {
    return;
  }

  range.selectNodeContents(element);
  selection.removeAllRanges();
  selection.addRange(range);
}

function renderDetailedChart(rootEl, canvas, chartData) {
  if (!canvas) return;

  const chartState = getChartState(rootEl);
  chartState.detailedChart = destroyChart(chartState.detailedChart);

  const ChartCtor = globalThis.Chart;
  if (typeof ChartCtor !== "function") {
    return;
  }

  chartState.detailedChart = new ChartCtor(canvas.getContext("2d"), {
    type: "bar",
    data: {
      labels: chartData.labels,
      datasets: [
        buildArrayChartDataset(
          "Avance",
          chartData.dataWithIndice,
          chartData.rawCountsWithIndice,
          CHART_COLORS.done,
        ),
        buildArrayChartDataset(
          "Non avance",
          chartData.dataWithoutIndice,
          chartData.rawCountsWithoutIndice,
          CHART_COLORS.remaining,
        ),
      ],
    },
    options: getChartOptions("Avancement"),
    plugins: getChartPlugins(),
  });
}

function renderCharts(rootEl, elements, totals) {
  const chartState = getChartState(rootEl);
  chartState.expensesChart = destroyChart(chartState.expensesChart);
  chartState.generalChart = destroyChart(chartState.generalChart);

  const realExpensesPercentage = getSpendingPercentage(
    totals.realExpenses,
    totals.totalVentilation,
  );

  chartState.expensesChart = renderProgressChart({
    canvas: elements.expensesChartCanvas,
    title: "Avancement dépenses",
    doneLabel: "Dépenses réelles",
    remainingLabel: "Budget restant",
    donePercentage: realExpensesPercentage,
    remainingPercentage: getRemainingPercentage(realExpensesPercentage, totals.totalVentilation),
    doneRaw: totals.realExpenses,
    remainingRaw: Math.max(0, totals.totalVentilation - totals.realExpenses),
    rawFormatter: formatNumber,
  });

  chartState.generalChart = renderProgressChart({
    canvas: elements.generalChartCanvas,
    title: "Avancement général",
    doneLabel: "Plans diffusés",
    remainingLabel: "Plans restants",
    donePercentage: totals.percentage,
    remainingPercentage: getRemainingPercentage(totals.percentage, totals.totalDocs),
    doneRaw: totals.withIndice,
    remainingRaw: totals.withoutIndice,
    rawFormatter: formatNumber,
  });
}

function buildArrayChartDataset(label, percentages, rawValues, colors) {
  const data = percentages.map(clampChartPercentage);

  return {
    label,
    data,
    rawValues,
    rawFormatter: formatNumber,
    backgroundColor: colors.fill,
    borderColor: colors.solid,
    borderWidth: 1,
    progressRole: getProgressRole(colors),
    borderRadius: getStackedBarRadius(8),
    borderSkipped: false,
    barPercentage: 0.72,
    categoryPercentage: 0.78,
    datalabels: {
      labels: {
        value: {
          formatter: formatChartDataLabel,
        },
      },
    },
  };
}

function renderProgressChart({
  canvas,
  title,
  doneLabel,
  remainingLabel,
  donePercentage,
  remainingPercentage,
  doneRaw,
  remainingRaw,
  rawFormatter,
}) {
  const ChartCtor = globalThis.Chart;
  if (!canvas || typeof ChartCtor !== "function") {
    return null;
  }

  return new ChartCtor(canvas.getContext("2d"), {
    type: "bar",
    data: {
      labels: [""],
      datasets: [
        buildChartDataset(
          doneLabel,
          clampChartPercentage(donePercentage),
          doneRaw,
          CHART_COLORS.done,
          rawFormatter,
        ),
        buildChartDataset(
          remainingLabel,
          clampChartPercentage(remainingPercentage),
          remainingRaw,
          CHART_COLORS.remaining,
          rawFormatter,
        ),
      ],
    },
    options: getChartOptions(title),
    plugins: getChartPlugins(),
  });
}

function buildChartDataset(label, percentage, rawValue, colors, rawFormatter) {
  return {
    label,
    data: [percentage],
    rawValues: [rawValue],
    rawFormatter,
    backgroundColor: colors.fill,
    borderColor: colors.solid,
    borderWidth: 1,
    progressRole: getProgressRole(colors),
    borderRadius: getStackedBarRadius(10),
    borderSkipped: false,
    barPercentage: 0.62,
    categoryPercentage: 0.72,
    datalabels: {
      labels: {
        value: {
          formatter: formatChartDataLabel,
        },
      },
    },
  };
}

function getChartPlugins() {
  return typeof globalThis.ChartDataLabels !== "undefined"
    ? [globalThis.ChartDataLabels]
    : [];
}

function getProgressRole(colors) {
  return colors === CHART_COLORS.done ? "done" : "remaining";
}

function getStackedBarRadius(radius) {
  return (context) => {
    const role = context.dataset.progressRole;
    const ownValue = toFiniteNumber(context.raw, 0);
    const oppositeRole = role === "done" ? "remaining" : "done";
    const oppositeDataset = context.chart.data.datasets.find(
      (dataset) => dataset.progressRole === oppositeRole,
    );
    const oppositeValue = toFiniteNumber(oppositeDataset?.data?.[context.dataIndex], 0);

    if (ownValue <= 0) {
      return 0;
    }

    if (oppositeValue <= 0) {
      return radius;
    }

    if (role === "done") {
      return {
        topLeft: radius,
        bottomLeft: radius,
        topRight: 0,
        bottomRight: 0,
      };
    }

    return {
      topLeft: 0,
      bottomLeft: 0,
      topRight: radius,
      bottomRight: radius,
    };
  };
}

function formatChartDataLabel(_value, context) {
  const value = context.dataset.rawValues[context.dataIndex];
  const formatter = context.dataset.rawFormatter || formatNumber;
  return formatter(value);
}

function getChartOptions(title) {
  return {
    indexAxis: "y",
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      x: {
        stacked: true,
        max: 100,
        ticks: {
          color: "#5a7188",
          callback: (value) => `${value}%`,
        },
        grid: {
          color: "rgba(0, 73, 144, 0.08)",
          drawBorder: false,
        },
      },
      y: {
        stacked: true,
        ticks: {
          color: "#17324d",
          font: {
            weight: "bold",
          },
        },
        grid: {
          display: false,
          drawBorder: false,
        },
      },
    },
    plugins: {
      title: {
        display: true,
        text: title,
        color: "#17324d",
        align: "start",
        padding: {
          bottom: 16,
        },
        font: {
          size: 15,
          weight: "bold",
        },
      },
      legend: {
        position: "bottom",
        labels: {
          usePointStyle: true,
          pointStyle: "rectRounded",
          boxWidth: 10,
          boxHeight: 10,
          padding: 14,
          color: "#17324d",
          font: {
            size: 11,
          },
        },
      },
      tooltip: {
        backgroundColor: "rgba(8, 21, 38, 0.92)",
        titleColor: "#ffffff",
        bodyColor: "#ffffff",
        borderColor: "rgba(255, 255, 255, 0.12)",
        borderWidth: 1,
        padding: 10,
        displayColors: true,
        callbacks: {
          label: formatTooltipLabel,
        },
      },
      datalabels: {
        color: "#17324d",
        display: (context) => context.dataset.data[context.dataIndex] > 0,
        font: {
          weight: "bold",
          size: 10,
        },
        formatter: formatChartPercentageLabel,
      },
    },
  };
}

function formatChartPercentageLabel(value) {
  const roundedValue = Math.round(toFiniteNumber(value, 0));
  return roundedValue > 0 ? `${roundedValue}%` : "";
}

function formatTooltipLabel(context) {
  const label = context.dataset.label ? `${context.dataset.label}: ` : "";
  const percentage = context.parsed.x !== null ? `${Math.round(context.parsed.x)}%` : "";
  const rawValue = context.dataset.rawValues[context.dataIndex];
  const formatter = context.dataset.rawFormatter || formatNumber;
  const formattedRawValue = formatter(rawValue);

  return `${label}${percentage} (${formattedRawValue})`;
}

function destroyChart(chart) {
  if (chart && typeof chart.destroy === "function") {
    chart.destroy();
  }

  return null;
}

function destroyCharts(rootEl) {
  const chartState = getChartState(rootEl);
  chartState.detailedChart = destroyChart(chartState.detailedChart);
  chartState.expensesChart = destroyChart(chartState.expensesChart);
  chartState.generalChart = destroyChart(chartState.generalChart);
}

function hideDashboard(elements) {
  elements.chartContainer.style.display = "none";
  elements.chartsGrid.style.display = "none";
  elements.sidePanel.style.display = "none";
  elements.sidePanel.closest(".avancement-dashboard-layout")?.classList.remove(
    "avancement-dashboard-layout--full",
  );
}

function showDashboard(elements) {
  elements.chartContainer.style.display = "block";
  elements.chartsGrid.style.display = "grid";
  elements.sidePanel.style.display = "block";
}

function renderEmptyState(rootEl, message) {
  const elements = getElements(rootEl);
  destroyCharts(rootEl);
  hideDashboard(elements);
  elements.statsOutput.innerHTML = `<p class="avancement-empty-state">${escapeHtml(message)}</p>`;
  elements.sidePanel.innerHTML = "";
}

export function clearAvancementDashboard(rootEl) {
  if (!(rootEl instanceof HTMLElement)) {
    return;
  }

  const elements = getElements(rootEl);
  destroyCharts(rootEl);
  rootEl.hidden = true;
  elements.statsOutput.innerHTML = "";
  elements.sidePanel.innerHTML = "";
  elements.sidePanel.hidden = false;
  elements.sidePanel.style.display = "";
  elements.sidePanel.closest(".avancement-dashboard-layout")?.classList.remove(
    "avancement-dashboard-layout--full",
  );
}

export function renderAvancementDashboard(rootEl, project, options = {}) {
  if (!(rootEl instanceof HTMLElement)) {
    return;
  }

  if (!project) {
    clearAvancementDashboard(rootEl);
    return;
  }

  rootEl.hidden = false;

  const elements = getElements(rootEl);
  const projectRecords = getProjectRecords(project);

  if (projectRecords.length === 0) {
    renderEmptyState(rootEl, "Aucun plan ListePlan_NDC_COF pour ce projet.");
    return;
  }

  const projectConfig = getProjectConfig(project);
  const ventilation = buildBudgetVentilation(project?.budgetLines || [], getDocumentTypes(projectRecords));
  const realExpenses = calculateRealExpenses(project);
  const dashboardData = buildDashboardData(
    projectRecords,
    ventilation,
    projectConfig,
    realExpenses,
  );

  showDashboard(elements);
  renderDetailedChart(rootEl, elements.chartCanvas, dashboardData.chart);
  renderStatsTable(elements.statsOutput, dashboardData.tableRows, dashboardData.totals, projectConfig.canSave);
  renderSidePanel(elements.sidePanel, project, dashboardData, projectRecords, projectConfig);
  renderCharts(rootEl, elements, dashboardData.totals);
  bindBudgetProgressControls(rootEl, project, options);
  bindIndexSelectionControls(rootEl, project, projectRecords, dashboardData.selectedIndicesByType, options);
}

function clampPercentage(value) {
  return Math.max(0, Math.min(100, Math.round(toFiniteNumber(value, 0))));
}

function clampChartPercentage(value) {
  return Math.max(0, Math.min(100, toFiniteNumber(value, 0)));
}

function getRemainingPercentage(donePercentage, total) {
  return toFiniteNumber(total, 0) > 0 ? 100 - clampChartPercentage(donePercentage) : 0;
}

function getSpendingPercentage(realExpenses, totalBudget) {
  const budget = toFiniteNumber(totalBudget, 0);
  if (budget <= 0) {
    return 0;
  }

  return (Math.max(0, toFiniteNumber(realExpenses, 0)) / budget) * 100;
}

function compareIndices(a, b) {
  const aMinimumIndex = INDICES.minimumSelectable.indexOf(a);
  const bMinimumIndex = INDICES.minimumSelectable.indexOf(b);

  if (aMinimumIndex !== -1 || bMinimumIndex !== -1) {
    if (aMinimumIndex === -1) return 1;
    if (bMinimumIndex === -1) return -1;
    return aMinimumIndex - bMinimumIndex;
  }

  return compareText(a, b);
}

function compareText(a, b) {
  return String(a).localeCompare(String(b), "fr", {
    numeric: true,
    sensitivity: "base",
  });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatNumber(value) {
  return String(Math.round(toFiniteNumber(value, 0))).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

function formatTableValue(value) {
  return value == null ? "-" : Math.round(toFiniteNumber(value, 0));
}

function formatPercentage(value) {
  return `${Math.round(toFiniteNumber(value, 0))}%`;
}

function formatInputNumber(value) {
  return String(Math.round(toFiniteNumber(value, 0)));
}
