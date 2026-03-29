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
  dom.totalProjectBudget.textContent = `${formatNumber(totalBudget)} €`;

  dom.currentProjectBudgetBreakdown.innerHTML = (project?.budgetLines || [])
    .map(
      (line) =>
        `<p>${escapeHtml(line.chapter)} : ${formatNumber(line.amount)} €</p>`
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
        `<p>${escapeHtml(line.chapter)} : ${formatNumber(line.amount)} €</p>`
    )
    .join("");
}

export function renderEditBudgetLines(container, budgetLines, editingIndex = null) {
  const lines = Array.isArray(budgetLines) ? budgetLines : [];

  if (!lines.length) {
    container.innerHTML = `
      <div class="budget-edit-empty-state">
        Aucune ligne de budget pour le moment.
      </div>
    `;
    return;
  }

  container.innerHTML = lines
    .map(
      (line, index) => `
        <div class="budget-edit-row${
          index === editingIndex ? " is-editing" : ""
        }" data-index="${index}" draggable="true">
          <div class="budget-edit-line-content">
            <div class="budget-edit-line-title">${escapeHtml(line.chapter)}</div>
            <div class="budget-edit-line-amount">${formatNumber(line.amount)} €</div>
          </div>
          <div class="budget-edit-row-actions">
            <button
              type="button"
              class="modify-budget-line-btn"
              data-index="${index}"
            >
              ${index === editingIndex ? "En cours" : "Modifier"}
            </button>
            <button type="button" class="delete-budget-line-btn" data-index="${index}">Supprimer</button>
          </div>
        </div>
      `
    )
    .join("");
}

export function openModal(modal) {
  toggleElement(modal, true, "flex");
}

export function closeModal(modal) {
  toggleElement(modal, false, "block");
}
