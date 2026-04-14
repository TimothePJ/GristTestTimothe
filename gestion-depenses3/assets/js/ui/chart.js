import {
  buildChartSeries,
  getBillingAmountFromPercentage,
  getProjectBudgetTotal,
} from "../services/projectService.js";
import { formatNumber } from "../utils/format.js";

const SPENDING_CHART_COLORS = {
  provisional: {
    solid: "rgba(121, 128, 138, 1)",
    fill: "rgba(121, 128, 138, 0.45)",
  },
  real: {
    solid: "rgba(232, 126, 43, 1)",
    fill: "rgba(232, 126, 43, 0.45)",
  },
  billing: {
    solid: "rgba(43, 123, 201, 1)",
    fill: "rgba(43, 123, 201, 0.45)",
  },
  budget: {
    solid: "rgba(255, 36, 36, 0.9)",
  },
};

let spendingChartBarsFromTop = false;

export function destroyChart(chart) {
  if (chart && typeof chart.destroy === "function") {
    chart.destroy();
  }
  return null;
}

function getChartPlugins() {
  const chartPlugins = [];
  if (typeof globalThis.ChartDataLabels !== "undefined") {
    chartPlugins.push(globalThis.ChartDataLabels);
  }
  return chartPlugins;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatNumericInputValue(value, maximumFractionDigits = 2) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return "";
  }

  return numericValue
    .toFixed(maximumFractionDigits)
    .replace(/\.0+$/, "")
    .replace(/(\.\d*?)0+$/, "$1");
}

export function clearSpendingBillingEditor(boardEl) {
  if (!(boardEl instanceof HTMLElement)) {
    return;
  }

  boardEl.innerHTML = "";
}

export function clearSpendingChartControls(boardEl) {
  if (!(boardEl instanceof HTMLElement)) {
    return;
  }

  boardEl.innerHTML = "";
}

export function getSpendingChartBarsFromTop() {
  return Boolean(spendingChartBarsFromTop);
}

export function setSpendingChartBarsFromTop(value) {
  spendingChartBarsFromTop = Boolean(value);
}

export function renderSpendingChartControls(boardEl) {
  if (!(boardEl instanceof HTMLElement)) {
    return;
  }

  const barsFromTopChecked = getSpendingChartBarsFromTop() ? "checked" : "";

  boardEl.innerHTML = `
    <div class="spending-chart-controls-row">
      <label class="billing-editor-toggle">
        <input
          type="checkbox"
          class="spending-chart-bars-toggle-input"
          ${barsFromTopChecked}
        >
        <span class="billing-editor-toggle-label">Colonnes depuis le haut</span>
      </label>
    </div>
  `;
}

export function renderSpendingBillingEditor(boardEl, project, viewState) {
  if (!(boardEl instanceof HTMLElement)) {
    return;
  }

  if (!project) {
    clearSpendingBillingEditor(boardEl);
    return;
  }

  const { displayedMonths, billingPercentData } = buildChartSeries(project, viewState);
  const totalBudget = getProjectBudgetTotal(project);

  boardEl.innerHTML = `
    <section class="billing-editor-panel">
      <div class="billing-editor-copy">
        <strong class="billing-editor-title">Facturation mensuelle</strong>
        <span class="billing-editor-subtitle">
          Renseigne le pourcentage ou le montant facture pour chaque mois affiche dans le graphique.
        </span>
      </div>
      <div class="billing-editor-scroll">
        <div class="billing-editor-grid">
          ${displayedMonths
            .map((month, index) => {
              const monthLabel = `${month.monthLabel} ${month.year}`;
              const monthKey = month.monthKey;
              const percentageInputId = `billing-percentage-${project.id}-${monthKey}`;
              const amountInputId = `billing-amount-${project.id}-${monthKey}`;
              const billingPercentage = Number(billingPercentData[index] ?? 100);
              const billingAmount = getBillingAmountFromPercentage(totalBudget, billingPercentage);

              return `
                <div class="billing-editor-item">
                  <span class="billing-editor-month">${escapeHtml(monthLabel)}</span>
                  <div class="billing-editor-fields">
                    <label class="billing-editor-field" for="${escapeHtml(percentageInputId)}">
                      <span class="billing-editor-field-label">Pourcentage</span>
                      <span class="billing-editor-input-shell">
                        <input
                          id="${escapeHtml(percentageInputId)}"
                          type="number"
                          class="cell-input billing-percentage billing-editor-input"
                          data-month="${escapeHtml(monthKey)}"
                          min="0"
                          step="0.1"
                          value="${escapeHtml(formatNumericInputValue(billingPercentage, 4))}"
                        >
                        <span class="billing-editor-unit">%</span>
                      </span>
                    </label>
                    <label class="billing-editor-field" for="${escapeHtml(amountInputId)}">
                      <span class="billing-editor-field-label">Montant</span>
                      <span class="billing-editor-input-shell">
                        <input
                          id="${escapeHtml(amountInputId)}"
                          type="number"
                          class="cell-input billing-amount billing-editor-input"
                          data-month="${escapeHtml(monthKey)}"
                          min="0"
                          step="0.01"
                          value="${escapeHtml(formatNumericInputValue(billingAmount, 2))}"
                        >
                        <span class="billing-editor-unit">€</span>
                      </span>
                    </label>
                  </div>
                </div>
              `;
            })
            .join("")}
        </div>
      </div>
    </section>
  `;
}

export function renderSpendingChart(canvas, currentChart, project, viewState) {
  const ChartCtor = globalThis.Chart;
  if (!canvas || typeof ChartCtor !== "function") {
    return currentChart;
  }

  const {
    labels,
    provisionalSpendingData,
    realSpendingData,
    billedAmountData,
    provisionalPercentData,
    realPercentData,
    billingPercentData,
  } = buildChartSeries(project, viewState);

  destroyChart(currentChart);

  const totalBudget = getProjectBudgetTotal(project);
  const barsFromTop = getSpendingChartBarsFromTop();
  const barDataLabels = barsFromTop
    ? { align: "start", anchor: "start" }
    : { align: "end", anchor: "end" };

  return new ChartCtor(canvas, {
    type: "bar",
    plugins: getChartPlugins(),
    data: {
      labels,
      datasets: [
        {
          type: "line",
          label: "Avancement previsionnel (%)",
          data: provisionalPercentData,
          borderColor: SPENDING_CHART_COLORS.provisional.solid,
          borderWidth: 2,
          fill: false,
          yAxisID: "y",
          tension: 0.1,
          datalabels: { align: "top", anchor: "end" },
        },
        {
          type: "line",
          label: "Avancement reel (%)",
          data: realPercentData,
          borderColor: SPENDING_CHART_COLORS.real.solid,
          borderWidth: 2,
          fill: false,
          yAxisID: "y",
          tension: 0.1,
          datalabels: { align: "top", anchor: "end" },
        },
        {
          type: "line",
          label: "Pourcentage facturation (%)",
          data: billingPercentData,
          borderColor: SPENDING_CHART_COLORS.billing.solid,
          borderWidth: 2,
          fill: false,
          yAxisID: "y",
          tension: 0.1,
          datalabels: { align: "top", anchor: "end" },
        },
        {
          type: "bar",
          label: "Depenses previsionnelles cumulees (€)",
          data: provisionalSpendingData,
          backgroundColor: SPENDING_CHART_COLORS.provisional.fill,
          borderColor: SPENDING_CHART_COLORS.provisional.solid,
          borderWidth: 1,
          yAxisID: "y1",
          datalabels: barDataLabels,
        },
        {
          type: "bar",
          label: "Depenses reelles cumulees (€)",
          data: realSpendingData,
          backgroundColor: SPENDING_CHART_COLORS.real.fill,
          borderColor: SPENDING_CHART_COLORS.real.solid,
          borderWidth: 1,
          yAxisID: "y1",
          datalabels: barDataLabels,
        },
        {
          type: "bar",
          label: "Montant facture mensuel (â‚¬)",
          data: billedAmountData,
          backgroundColor: SPENDING_CHART_COLORS.billing.fill,
          borderColor: SPENDING_CHART_COLORS.billing.solid,
          borderWidth: 1,
          yAxisID: "y1",
          datalabels: barDataLabels,
        },
        {
          type: "line",
          label: "Budget total (€)",
          data: labels.map(() => totalBudget),
          borderColor: SPENDING_CHART_COLORS.budget.solid,
          borderDash: [6, 4],
          borderWidth: 2,
          pointRadius: 0,
          fill: false,
          yAxisID: "y1",
          datalabels: { display: false },
        },
      ],
    },
    options: {
      responsive: true,
      interaction: {
        mode: "index",
        intersect: false,
      },
      stacked: false,
      scales: {
        y: {
          type: "linear",
          display: true,
          position: "left",
          beginAtZero: true,
          title: {
            display: true,
            text: "% Budget",
          },
          ticks: {
            callback(value) {
              return `${value}%`;
            },
          },
        },
        y1: {
          type: "linear",
          display: true,
          position: "right",
          beginAtZero: true,
          reverse: barsFromTop,
          title: {
            display: true,
            text: "Montant (€)",
          },
          grid: {
            drawOnChartArea: false,
          },
          ticks: {
            callback(value) {
              return `${formatNumber(value)} €`;
            },
          },
        },
      },
      plugins: {
        legend: {
          position: "bottom",
          labels: {
            usePointStyle: true,
            pointStyle: "rectRounded",
            boxWidth: 10,
            boxHeight: 10,
            padding: 14,
            font: {
              size: 11,
            },
          },
        },
        datalabels: {
          color: "#000",
          font: {
            weight: "bold",
            size: 10,
          },
          display: "auto",
          formatter(value, context) {
            if (value === 0) return "";
            if (context.dataset.yAxisID === "y") {
              return `${Number(value).toFixed(1)}%`;
            }
            return `${Math.round(value).toLocaleString("fr-FR")} €`;
          },
        },
        tooltip: {
          callbacks: {
            label(context) {
              let label = context.dataset.label || "";
              if (label) {
                label += ": ";
              }
              if (context.parsed.y != null) {
                if (context.dataset.yAxisID === "y") {
                  label += `${context.parsed.y.toFixed(2)}%`;
                } else {
                  label += `${formatNumber(context.parsed.y)} €`;
                }
              }
              return label;
            },
          },
        },
      },
    },
  });
}

export function renderGroupedExpenseChart(
  canvas,
  currentChart,
  { labels, datasets, suggestedMax, unit = "currency" }
) {
  const ChartCtor = globalThis.Chart;
  if (!canvas || typeof ChartCtor !== "function") {
    return currentChart;
  }

  destroyChart(currentChart);

  const isDaysUnit = unit === "days";
  const yAxisLabel = isDaysUnit ? "Jours travailles" : "Montant (€)";

  return new ChartCtor(canvas, {
    type: "bar",
    plugins: getChartPlugins(),
    data: {
      labels,
      datasets,
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: "index",
        intersect: false,
      },
      stacked: false,
      scales: {
        x: {
          offset: true,
          ticks: {
            maxRotation: 0,
            autoSkip: true,
          },
          grid: {
            display: false,
          },
          border: {
            display: false,
          },
        },
        y: {
          beginAtZero: true,
          suggestedMax: Math.max(Number(suggestedMax) || 0, 1),
          title: {
            display: true,
            text: yAxisLabel,
          },
          ticks: {
            callback(value) {
              return isDaysUnit ? `${formatNumber(value)} j` : `${formatNumber(value)} €`;
            },
          },
          grid: {
            color: "rgba(0, 73, 144, 0.08)",
          },
          border: {
            display: false,
          },
        },
      },
      plugins: {
        legend: {
          position: "bottom",
          labels: {
            usePointStyle: true,
            pointStyle: "rectRounded",
            boxWidth: 10,
            boxHeight: 10,
            padding: 14,
            font: {
              size: 11,
            },
          },
        },
        datalabels: {
          display: false,
        },
        tooltip: {
          callbacks: {
            label(context) {
              const label = context.dataset.label || "";
              const suffix = isDaysUnit ? "j" : "€";
              return `${label}: ${formatNumber(context.parsed.y || 0)} ${suffix}`;
            },
          },
        },
      },
    },
  });
}
