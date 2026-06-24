import { CHART_COLORS } from "./config.js";
import { formatDays, formatPercent } from "./utils.js";

let chartInstance = null;

export function renderOccupationChart(canvas, rows) {
  if (!canvas) return;
  if (chartInstance) {
    chartInstance.destroy();
    chartInstance = null;
  }

  if (!rows.length) return;

  chartInstance = new Chart(canvas, {
    type: "doughnut",
    data: {
      labels: rows.map((row) => row.label),
      datasets: [{
        data: rows.map((row) => Number(row.days.toFixed(3))),
        backgroundColor: rows.map((row, index) => row.color || CHART_COLORS[index % CHART_COLORS.length]),
        borderColor: "#ffffff",
        borderWidth: 3,
        hoverOffset: 10,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "58%",
      plugins: {
        legend: {
          position: "bottom",
          labels: {
            boxWidth: 12,
            color: "#17324d",
            font: { family: "Segoe UI" },
          },
        },
        tooltip: {
          callbacks: {
            label(context) {
              const row = rows[context.dataIndex];
              return ` ${row.label}: ${formatDays(row.days)} (${formatPercent(row.percent)})`;
            },
          },
        },
      },
    },
  });
}
