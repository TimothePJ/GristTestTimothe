import { getProjectKpis } from "../services/projectService.js";
import { formatNumber } from "../utils/format.js";

export function renderKpi(dom, project) {
  const kpis = getProjectKpis(project);
  dom.kpiTotalBudget.textContent = `${formatNumber(
    kpis.totalBudget
  )} EUR (Assigne : ${formatNumber(kpis.totalProvisionalSpending)} EUR)`;
  dom.kpiTotalSpending.textContent = `${formatNumber(kpis.totalRealSpending)} EUR`;
  dom.kpiRemainingBudget.textContent = `${formatNumber(kpis.remainingBudget)} EUR`;
  dom.kpiRemainingPercentage.textContent = `${kpis.remainingPercentage
    .toFixed(2)
    .replace(".", ",")} %`;
}

export function clearKpi(dom) {
  dom.kpiTotalBudget.textContent = "";
  dom.kpiTotalSpending.textContent = "";
  dom.kpiRemainingBudget.textContent = "";
  dom.kpiRemainingPercentage.textContent = "";
}
