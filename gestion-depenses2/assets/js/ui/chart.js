import { buildChartSeries, getProjectBudgetTotal } from "../services/projectService.js";
import { formatNumber } from "../utils/format.js";

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

export function renderSpendingChart(canvas, currentChart, project, viewState) {
  const ChartCtor = globalThis.Chart;
  if (!canvas || typeof ChartCtor !== "function") {
    return currentChart;
  }

  const {
    labels,
    provisionalSpendingData,
    realSpendingData,
    provisionalPercentData,
    realPercentData,
    billingPercentData,
  } = buildChartSeries(project, viewState);

  destroyChart(currentChart);

  const totalBudget = getProjectBudgetTotal(project);

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
          borderColor: "rgba(255, 99, 132, 1)",
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
          borderColor: "rgba(54, 162, 235, 1)",
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
          borderColor: "rgba(75, 192, 192, 1)",
          borderWidth: 2,
          fill: false,
          yAxisID: "y",
          tension: 0.1,
          datalabels: { align: "top", anchor: "end" },
        },
        {
          type: "bar",
          label: "Depenses previsionnelles cumulees (EUR)",
          data: provisionalSpendingData,
          backgroundColor: "rgba(255, 99, 132, 0.5)",
          borderColor: "rgba(255, 99, 132, 1)",
          borderWidth: 1,
          yAxisID: "y1",
          datalabels: { align: "end", anchor: "end" },
        },
        {
          type: "bar",
          label: "Depenses reelles cumulees (EUR)",
          data: realSpendingData,
          backgroundColor: "rgba(54, 162, 235, 0.5)",
          borderColor: "rgba(54, 162, 235, 1)",
          borderWidth: 1,
          yAxisID: "y1",
          datalabels: { align: "end", anchor: "end" },
        },
        {
          type: "line",
          label: "Budget total (EUR)",
          data: labels.map(() => totalBudget),
          borderColor: "rgba(0, 73, 144, 0.7)",
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
          title: {
            display: true,
            text: "Montant (EUR)",
          },
          grid: {
            drawOnChartArea: false,
          },
          ticks: {
            callback(value) {
              return `${formatNumber(value)} EUR`;
            },
          },
        },
      },
      plugins: {
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
            return `${Math.round(value).toLocaleString("fr-FR")} EUR`;
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
                  label += `${formatNumber(context.parsed.y)} EUR`;
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
  const yAxisLabel = isDaysUnit ? "Jours travailles" : "Montant (EUR)";

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
              return isDaysUnit ? `${formatNumber(value)} j` : `${formatNumber(value)} EUR`;
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
              const suffix = isDaysUnit ? "j" : "EUR";
              return `${label}: ${formatNumber(context.parsed.y || 0)} ${suffix}`;
            },
          },
        },
      },
    },
  });
}
