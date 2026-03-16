import { APP_CONFIG } from "../config.js";
import {
  calculateProvisionalSpending,
  calculateRealSpending,
  getBillingPercentageForMonth,
  getPriorCumulativeBilling,
  getPriorCumulativeSpending,
  getProjectBudgetTotal,
  getWorkerTotalDays,
  groupWorkersByRole,
} from "../services/projectService.js";
import { buildDisplayedMonths, formatNumber, toFiniteNumber } from "../utils/format.js";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function buildHeader(headRow, leadColumns, displayedMonths) {
  headRow.innerHTML = leadColumns.map((column) => `<th>${column}</th>`).join("");
  displayedMonths.forEach(({ monthLabel, year }) => {
    headRow.innerHTML += `<th>${monthLabel}<br>${year}</th>`;
  });
}

function renderRoleRow(label, columnCount) {
  return `<tr class="role-row"><td colspan="${columnCount}"><strong>${escapeHtml(
    label
  )}</strong></td></tr>`;
}

function renderNumberInput(className, dataAttributes, value) {
  const attrs = Object.entries(dataAttributes)
    .map(([key, attrValue]) => `data-${key}="${escapeHtml(attrValue)}"`)
    .join(" ");

  const displayValue = value || value === 0 ? value : "";
  return `<input type="number" class="cell-input ${className}" ${attrs} step="0.1" value="${
    displayValue === 0 ? "" : escapeHtml(displayValue)
  }">`;
}

function renderExpenseTable(dom, project, displayedMonths) {
  buildHeader(
    dom.expenseHeadRow,
    ["Nom", "Depense journaliere", "Total depense"],
    displayedMonths
  );

  const groupedWorkers = groupWorkersByRole(project.workers);
  const columnCount = 3 + displayedMonths.length;
  let html = "";

  Object.entries(groupedWorkers).forEach(([role, workers]) => {
    html += renderRoleRow(role, columnCount);

    workers.forEach((worker) => {
      const totalProvisionalDays = getWorkerTotalDays(worker.provisionalDays);
      const totalProvisionalCost = totalProvisionalDays * toFiniteNumber(worker.dailyRate, 0);

      html += `
        <tr>
          <td>${escapeHtml(worker.name)}</td>
          <td>${renderNumberInput("daily-rate", { workerId: worker.id }, worker.dailyRate)}</td>
          <td>${formatNumber(totalProvisionalCost)} EUR</td>
      `;

      displayedMonths.forEach(({ monthKey }) => {
        const provisionalCost =
          toFiniteNumber(worker.provisionalDays?.[monthKey], 0) *
          toFiniteNumber(worker.dailyRate, 0);
        html += `<td>${formatNumber(provisionalCost)} EUR</td>`;
      });

      html += "</tr>";
    });
  });

  const grandTotalProvisionalCost = (project.workers || []).reduce((total, worker) => {
    return total + getWorkerTotalDays(worker.provisionalDays) * toFiniteNumber(worker.dailyRate, 0);
  }, 0);

  html += `<tr><td colspan="2"><strong>Total</strong></td><td><strong>${formatNumber(
    grandTotalProvisionalCost
  )} EUR</strong></td>`;
  displayedMonths.forEach(({ monthKey }) => {
    html += `<td><strong>${formatNumber(
      calculateProvisionalSpending(project, monthKey)
    )} EUR</strong></td>`;
  });
  html += "</tr>";

  dom.expenseTableBody.innerHTML = html;
}

function renderRealExpenseTable(dom, project, displayedMonths) {
  buildHeader(dom.realExpenseHeadRow, ["Nom", "Total jours", "Total depense"], displayedMonths);

  const groupedWorkers = groupWorkersByRole(project.workers);
  const columnCount = 3 + displayedMonths.length;
  let html = "";

  Object.entries(groupedWorkers).forEach(([role, workers]) => {
    html += renderRoleRow(role, columnCount);

    workers.forEach((worker) => {
      const totalWorkedDays = getWorkerTotalDays(worker.workedDays);
      const totalRealCost = totalWorkedDays * toFiniteNumber(worker.dailyRate, 0);

      html += `
        <tr>
          <td>${escapeHtml(worker.name)}</td>
          <td>${totalWorkedDays.toFixed(2)}</td>
          <td>${formatNumber(totalRealCost)} EUR</td>
      `;

      displayedMonths.forEach(({ monthKey }) => {
        html += `<td>${renderNumberInput(
          "worked-days",
          {
            workerId: worker.id,
            month: monthKey,
          },
          worker.workedDays?.[monthKey]
        )}</td>`;
      });

      html += "</tr>";
    });
  });

  const grandTotalWorkedDays = (project.workers || []).reduce((total, worker) => {
    return total + getWorkerTotalDays(worker.workedDays);
  }, 0);
  const grandTotalRealCost = (project.workers || []).reduce((total, worker) => {
    return total + getWorkerTotalDays(worker.workedDays) * toFiniteNumber(worker.dailyRate, 0);
  }, 0);

  html += `<tr><td><strong>Total</strong></td><td><strong>${grandTotalWorkedDays.toFixed(
    2
  )}</strong></td><td><strong>${formatNumber(grandTotalRealCost)} EUR</strong></td>`;
  displayedMonths.forEach(({ monthKey }) => {
    html += `<td><strong>${formatNumber(
      calculateRealSpending(project, monthKey)
    )} EUR</strong></td>`;
  });
  html += "</tr>";

  const totalBudget = getProjectBudgetTotal(project);
  const firstDisplayedMonth = displayedMonths[0]?.monthKey || "";
  let { real: currentCumulReal, provisional: currentCumulProv } =
    getPriorCumulativeSpending(project, firstDisplayedMonth);
  let currentCumulBilling = getPriorCumulativeBilling(project, firstDisplayedMonth);

  let cumulFacturationRow = `<tr><td colspan="3"><strong>Cumul facturation</strong></td>`;
  let radRow = `<tr><td colspan="3"><strong>RAD</strong></td>`;
  let ecartMensuelRow =
    `<tr><td colspan="3"><strong>ECART MENSUEL - FACTURE - PREV</strong></td>`;
  let cumulEcartRow =
    `<tr><td colspan="3"><strong>CUMUL ECART - FACTURE - PREV</strong></td>`;
  let billingPctRow =
    `<tr><td colspan="3"><strong>Pourcentage facturation</strong></td>`;

  displayedMonths.forEach(({ monthKey }) => {
    const monthlyReal = calculateRealSpending(project, monthKey);
    const monthlyProvisional = calculateProvisionalSpending(project, monthKey);
    const billingPct = getBillingPercentageForMonth(project, monthKey);
    const monthlyBilling = monthlyReal * (billingPct / 100);

    currentCumulReal += monthlyReal;
    currentCumulProv += monthlyProvisional;
    currentCumulBilling += monthlyBilling;

    const rad = totalBudget - currentCumulReal;
    const ecartMensuel = monthlyBilling - monthlyProvisional;
    const cumulEcart = currentCumulBilling - currentCumulProv;

    cumulFacturationRow += `<td><strong>${formatNumber(currentCumulBilling)} EUR</strong></td>`;
    radRow += `<td><strong>${formatNumber(rad)} EUR</strong></td>`;
    ecartMensuelRow += `<td><strong>${formatNumber(ecartMensuel)} EUR</strong></td>`;
    cumulEcartRow += `<td><strong>${formatNumber(cumulEcart)} EUR</strong></td>`;
    billingPctRow += `
      <td>
        <input
          type="number"
          class="cell-input billing-percentage"
          data-month="${monthKey}"
          min="0"
          max="100"
          step="0.1"
          value="${billingPct}"
        > %
      </td>
    `;
  });

  cumulFacturationRow += "</tr>";
  radRow += "</tr>";
  ecartMensuelRow += "</tr>";
  cumulEcartRow += "</tr>";
  billingPctRow += "</tr>";

  html += cumulFacturationRow;
  html += radRow;
  html += ecartMensuelRow;
  html += cumulEcartRow;
  html += billingPctRow;

  dom.realExpenseTableBody.innerHTML = html;
}

export function renderTables(dom, project, viewState) {
  const displayedMonths = buildDisplayedMonths(
    viewState.selectedYear,
    viewState.selectedMonth,
    viewState.monthSpan,
    APP_CONFIG.months
  );

  renderExpenseTable(dom, project, displayedMonths);
  renderRealExpenseTable(dom, project, displayedMonths);
}

export function clearTables(dom) {
  buildHeader(dom.expenseHeadRow, ["Nom", "Depense journaliere", "Total depense"], []);
  buildHeader(dom.realExpenseHeadRow, ["Nom", "Total jours", "Total depense"], []);
  dom.expenseTableBody.innerHTML = "";
  dom.realExpenseTableBody.innerHTML = "";
}
