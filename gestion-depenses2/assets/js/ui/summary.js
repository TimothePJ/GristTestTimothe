import { formatNumber } from "../utils/format.js";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function toggleElement(element, visible, displayValue = "") {
  if (!element) return;
  element.hidden = !visible;

  if (visible) {
    if (displayValue) {
      element.style.display = displayValue;
    } else {
      element.style.removeProperty("display");
    }
    return;
  }

  element.style.display = "none";
}

export function renderProjectSummary(dom, project, totalBudget) {
  dom.currentProjectName.textContent = project?.name || "";
  dom.currentProjectNumber.textContent = project?.projectNumber || "";
  dom.totalProjectBudget.textContent = `${formatNumber(totalBudget)} EUR`;

  dom.currentProjectBudgetBreakdown.innerHTML = (project?.budgetLines || [])
    .map(
      (line) =>
        `<p>${escapeHtml(line.chapter)} : ${formatNumber(line.amount)} EUR</p>`
    )
    .join("");
}

export function clearProjectSummary(dom) {
  dom.currentProjectName.textContent = "";
  dom.currentProjectNumber.textContent = "";
  dom.totalProjectBudget.textContent = "";
  dom.currentProjectBudgetBreakdown.innerHTML = "";
}

export function renderBudgetPreview(container, budgetLines) {
  container.innerHTML = (budgetLines || [])
    .map(
      (line) =>
        `<p>${escapeHtml(line.chapter)} : ${formatNumber(line.amount)} EUR</p>`
    )
    .join("");
}

export function renderEditBudgetLines(container, budgetLines) {
  container.innerHTML = (budgetLines || [])
    .map(
      (line, index) => `
        <div class="budget-line-row">
          <span>${escapeHtml(line.chapter)} : ${formatNumber(line.amount)} EUR</span>
          <button class="delete-budget-line-btn" data-index="${index}">Supprimer</button>
        </div>
      `
    )
    .join("");
}

export function openModal(modal) {
  toggleElement(modal, true, "block");
}

export function closeModal(modal) {
  toggleElement(modal, false, "block");
}
